import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';

export interface InfraEnvironmentConfig {
  readonly account: string;
  readonly region: string;
  readonly vpcName: string;
  readonly appSecurityGroupName: string;
  readonly albSecurityGroupId: string;
  readonly endpointSecurityGroupId: string;
  readonly clusterName: string;
  readonly ecrRepositoryName: string;
  readonly dbHost: string;
  readonly dbPort: number;
  readonly dbName: string;
  readonly dbSecretArn: string;
  readonly dbSecretKmsKeyArn: string;
  readonly existingLogsVpcEndpointId: string;
  readonly existingSecretsManagerVpcEndpointId: string;
  readonly existingKmsVpcEndpointId: string;
  readonly existingEcrApiVpcEndpointId: string | null;
  readonly existingEcrDockerVpcEndpointId: string | null;
  readonly existingStsVpcEndpointId: string | null;
  readonly cognitoUserPoolName: string;
  readonly cognitoAppClientName: string;
}

interface InfraStackProps extends cdk.StackProps {
  readonly config: InfraEnvironmentConfig;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Import existing VPC by name
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcName: config.vpcName,
    });

    // App Security Group (ECS tasks) - created/managed by CDK
    const appSg = new ec2.SecurityGroup(this, 'UnityAppealsAppSg', {
      vpc,
      securityGroupName: config.appSecurityGroupName,
      description: 'Security group for Unity Appeals ECS app',
      allowAllOutbound: true,
    });

    const endpointsSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ExistingEndpointsSg',
      config.endpointSecurityGroupId,
      { mutable: true }
    );

    // Allow ECS tasks to reach endpoint ENIs on TLS port
    new ec2.CfnSecurityGroupIngress(this, 'ExistingEndpointsSgFromAppSg443', {
      groupId: endpointsSg.securityGroupId,
      sourceSecurityGroupId: appSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      description: 'Allow ECS tasks to access interface endpoints over TLS',
    });

    // ALB Security Group - already exists, import it
    const albSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ExistingAlbSg',
      config.albSecurityGroupId,
      { mutable: true }
    );

    // Ensure ALB -> App allowed on port 3000
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Allow ALB to reach app on 3000');

    // ECS Cluster (dev)
    const cluster = new ecs.Cluster(this, 'UnityAppealsCluster', {
      vpc,
      clusterName: config.clusterName,
    });

    const userPool = new cognito.UserPool(this, 'UnityAppealsUserPool', {
      userPoolName: config.cognitoUserPoolName,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      customAttributes: {
        tenant_id: new cognito.StringAttribute({ minLen: 1, maxLen: 64, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('UnityAppealsWebClient', {
      userPoolClientName: config.cognitoAppClientName,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      preventUserExistenceErrors: true,
    });

    const cognitoRegion = cdk.Stack.of(this).region;
    const cognitoUserPoolId = userPool.userPoolId;
    const cognitoAppClientId = userPoolClient.userPoolClientId;
    const dbPort = String(config.dbPort);

    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ExistingDbCredentialsSecret',
      config.dbSecretArn
    );

    // ECR repo for the web image
    const webRepo = ecr.Repository.fromRepositoryName(
      this,
      'WebRepo',
      config.ecrRepositoryName
    );

    // TaskDefinition pinned to ARM64 (matches your pushed image)
    const taskDef = new ecs.FargateTaskDefinition(this, 'WebTaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    taskDef.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web' }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        COGNITO_REGION: cognitoRegion,
        COGNITO_USER_POOL_ID: cognitoUserPoolId,
        COGNITO_APP_CLIENT_ID: cognitoAppClientId,
        DATABASE_HOST: config.dbHost,
        DATABASE_PORT: dbPort,
        DATABASE_NAME: config.dbName,
        DATABASE_SSL: 'require',
        DEV_BYPASS_AUTH: 'false',
      },
      secrets: {
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
    });

    // Secret retrieval for task startup also requires decrypt on the secret's KMS key.
    taskDef.addToExecutionRolePolicy(
      new iam.PolicyStatement({
        actions: ['kms:Decrypt'],
        resources: [config.dbSecretKmsKeyArn],
        conditions: {
          StringEquals: {
            'kms:ViaService': `secretsmanager.${cdk.Stack.of(this).region}.amazonaws.com`,
            'kms:EncryptionContext:SecretARN': config.dbSecretArn,
          },
        },
      })
    );

    // Web service behind an internet-facing ALB
    const webService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'UnityAppealsWebService',
      {
        cluster,
        publicLoadBalancer: true,
        desiredCount: 1,
        securityGroups: [appSg],
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        taskDefinition: taskDef,
      }
    );

    // Add the pre-existing ALB SG (HTTPS allowed there)
    webService.loadBalancer.addSecurityGroup(albSg);
    webService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200-399',
    });

    new cdk.CfnOutput(this, 'AppSecurityGroupId', {
      value: appSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: albSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'EndpointsSecurityGroupId', {
      value: endpointsSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'ExistingLogsVpcEndpointId', {
      value: config.existingLogsVpcEndpointId,
    });

    new cdk.CfnOutput(this, 'ExistingSecretsManagerVpcEndpointId', {
      value: config.existingSecretsManagerVpcEndpointId,
    });

    new cdk.CfnOutput(this, 'ExistingKmsVpcEndpointId', {
      value: config.existingKmsVpcEndpointId,
    });

    new cdk.CfnOutput(this, 'ExistingEcrApiVpcEndpointId', {
      value: config.existingEcrApiVpcEndpointId ?? 'not-configured',
    });

    new cdk.CfnOutput(this, 'ExistingEcrDockerVpcEndpointId', {
      value: config.existingEcrDockerVpcEndpointId ?? 'not-configured',
    });

    new cdk.CfnOutput(this, 'ExistingStsVpcEndpointId', {
      value: config.existingStsVpcEndpointId ?? 'not-configured',
    });

    new cdk.CfnOutput(this, 'ConfiguredCognitoUserPoolId', {
      value: cognitoUserPoolId,
    });

    new cdk.CfnOutput(this, 'ConfiguredCognitoAppClientId', {
      value: cognitoAppClientId,
    });

    new cdk.CfnOutput(this, 'ConfiguredCognitoRegion', {
      value: cognitoRegion,
    });

    new cdk.CfnOutput(this, 'WebLoadBalancerDnsName', {
      value: webService.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'WebServiceUrl', {
      value: `http://${webService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
