import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as kms from 'aws-cdk-lib/aws-kms';

export interface StagingNetworkConfig {
  readonly account: string;
  readonly region: string;
  readonly vpcCidr: string;
  readonly maxAzs: number;
  readonly natGateways: number;
  readonly appSecurityGroupName: string;
  readonly albSecurityGroupName: string;
  readonly endpointSecurityGroupName: string;
  readonly rdsSecurityGroupName: string;
  readonly dbInstanceIdentifier: string;
  readonly dbName: string;
  readonly dbInstanceClass: string;
  readonly dbAllocatedStorageGb: number;
  readonly dbBackupRetentionDays: number;
  readonly dbPreferredBackupWindow: string;
  readonly dbPreferredMaintenanceWindow: string;
  readonly dbEnablePerformanceInsights: boolean;
  readonly dbDeletionProtection: boolean;
}

interface NetworkStackProps extends cdk.StackProps {
  readonly config: StagingNetworkConfig;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly appSecurityGroup: ec2.SecurityGroup;
  public readonly albSecurityGroup: ec2.SecurityGroup;
  public readonly endpointSecurityGroup: ec2.SecurityGroup;
  public readonly dbSecurityGroup: ec2.SecurityGroup;
  public readonly logsEndpoint: ec2.InterfaceVpcEndpoint;
  public readonly secretsManagerEndpoint: ec2.InterfaceVpcEndpoint;
  public readonly kmsEndpoint: ec2.InterfaceVpcEndpoint;
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbSecretKmsKey: kms.Key;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.vpc = new ec2.Vpc(this, 'StagingVpc', {
      ipAddresses: ec2.IpAddresses.cidr(config.vpcCidr),
      maxAzs: config.maxAzs,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: 'Public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 20 },
        { name: 'Private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
      ],
    });

    this.appSecurityGroup = new ec2.SecurityGroup(this, 'StagingAppSg', {
      vpc: this.vpc,
      securityGroupName: config.appSecurityGroupName,
      description: 'Security group for staging ECS tasks',
      allowAllOutbound: true,
    });

    this.albSecurityGroup = new ec2.SecurityGroup(this, 'StagingAlbSg', {
      vpc: this.vpc,
      securityGroupName: config.albSecurityGroupName,
      description: 'Public access for staging load balancer',
      allowAllOutbound: true,
    });
    this.albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP');

    this.endpointSecurityGroup = new ec2.SecurityGroup(this, 'StagingEndpointSg', {
      vpc: this.vpc,
      securityGroupName: config.endpointSecurityGroupName,
      description: 'Security group for staging VPC interface endpoints',
      allowAllOutbound: true,
    });

    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'StagingRdsSg', {
      vpc: this.vpc,
      securityGroupName: config.rdsSecurityGroupName,
      description: 'Security group for staging Postgres database access',
      allowAllOutbound: true,
    });

    this.dbSecurityGroup.addIngressRule(
      this.appSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow staging app tasks to access Postgres'
    );

    this.logsEndpoint = this.vpc.addInterfaceEndpoint('LogsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });
    this.logsEndpoint.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'aws:PrincipalAccount': config.account },
        },
      })
    );

    this.secretsManagerEndpoint = this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });

    this.kmsEndpoint = this.vpc.addInterfaceEndpoint('KmsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.KMS,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });

    this.vpc.addInterfaceEndpoint('EcrApiEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });
    this.vpc.addInterfaceEndpoint('EcrDkrEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });
    this.vpc.addInterfaceEndpoint('StsEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.STS,
      securityGroups: [this.endpointSecurityGroup],
      privateDnsEnabled: true,
    });
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
    });

    this.dbSecretKmsKey = new kms.Key(this, 'StagingDbSecretKmsKey', {
      enableKeyRotation: true,
      description: 'KMS key for staging DB master secret',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const dbInstanceType = this.toInstanceType(config.dbInstanceClass);

    this.dbInstance = new rds.DatabaseInstance(this, 'StagingDb', {
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [this.dbSecurityGroup],
      instanceIdentifier: config.dbInstanceIdentifier,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_4,
      }),
      instanceType: dbInstanceType,
      credentials: rds.Credentials.fromGeneratedSecret('postgres', {
        encryptionKey: this.dbSecretKmsKey,
      }),
      databaseName: config.dbName,
      allocatedStorage: config.dbAllocatedStorageGb,
      storageType: rds.StorageType.GP3,
      deletionProtection: config.dbDeletionProtection,
      backupRetention: cdk.Duration.days(config.dbBackupRetentionDays),
      preferredBackupWindow: config.dbPreferredBackupWindow,
      preferredMaintenanceWindow: config.dbPreferredMaintenanceWindow,
      performanceInsightRetention: config.dbEnablePerformanceInsights
        ? rds.PerformanceInsightRetention.DEFAULT
        : undefined,
      enablePerformanceInsights: config.dbEnablePerformanceInsights,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deleteAutomatedBackups: false,
      publiclyAccessible: false,
    });

    this.dbSecret = this.dbInstance.secret!;

    this.secretsManagerEndpoint.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['secretsmanager:DescribeSecret', 'secretsmanager:GetSecretValue'],
        resources: [this.dbSecret.secretArn],
        conditions: {
          StringEquals: { 'aws:PrincipalAccount': config.account },
        },
      })
    );

    this.kmsEndpoint.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.AnyPrincipal()],
        actions: ['kms:Decrypt', 'kms:DescribeKey'],
        resources: [this.dbSecretKmsKey.keyArn],
        conditions: {
          StringEquals: { 'aws:PrincipalAccount': config.account },
        },
      })
    );
  }

  private toInstanceType(value: string): ec2.InstanceType {
    const parts = value.split('.');
    if (parts.length !== 3 || parts[0] !== 'db') {
      throw new Error(`Invalid db instance class format: "${value}" (expected "db.<class>.<size>").`);
    }
    const instanceClass = parts[1];
    const instanceSize = parts[2];

    return ec2.InstanceType.of(
      this.toInstanceClass(instanceClass),
      this.toInstanceSize(instanceSize)
    );
  }

  private toInstanceClass(value: string): ec2.InstanceClass {
    const map: Record<string, ec2.InstanceClass> = {
      t4g: ec2.InstanceClass.T4G,
      t3: ec2.InstanceClass.T3,
    };
    const resolved = map[value];
    if (!resolved) {
      throw new Error(`Unsupported instance class: ${value}`);
    }
    return resolved;
  }

  private toInstanceSize(value: string): ec2.InstanceSize {
    const map: Record<string, ec2.InstanceSize> = {
      micro: ec2.InstanceSize.MICRO,
      small: ec2.InstanceSize.SMALL,
      medium: ec2.InstanceSize.MEDIUM,
      large: ec2.InstanceSize.LARGE,
    };
    const resolved = map[value];
    if (!resolved) {
      throw new Error(`Unsupported instance size: ${value}`);
    }
    return resolved;
  }
}
