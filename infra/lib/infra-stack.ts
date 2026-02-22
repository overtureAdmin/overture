import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import existing VPC by name
    const vpc = ec2.Vpc.fromLookup(this, 'ExistingVpc', {
      vpcName: 'unity-appeals-dev-vpc-vpc',
    });

    // App Security Group (ECS tasks) - created/managed by CDK
    const appSg = new ec2.SecurityGroup(this, 'UnityAppealsAppSg', {
      vpc,
      securityGroupName: 'unity-appeals-dev-app-sg',
      description: 'Security group for Unity Appeals ECS app',
      allowAllOutbound: true,
    });

    const existingEndpointSgId =
      this.node.tryGetContext('existingEndpointSecurityGroupId') ?? 'sg-0c03fdabccd351608';
    const endpointsSg = ec2.SecurityGroup.fromSecurityGroupId(
      this,
      'ExistingEndpointsSg',
      existingEndpointSgId,
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
      'sg-0eb1ef4f97ee4c029',
      { mutable: true }
    );

    // Ensure ALB -> App allowed on port 3000
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Allow ALB to reach app on 3000');

    // ECS Cluster (dev)
    const cluster = new ecs.Cluster(this, 'UnityAppealsCluster', {
      vpc,
      clusterName: 'unity-appeals-dev-cluster',
    });

    const cognitoRegion = this.node.tryGetContext('cognitoRegion') ?? 'us-east-1';
    const cognitoUserPoolId = this.node.tryGetContext('cognitoUserPoolId') ?? 'us-east-1_70AMzJCnx';
    const cognitoAppClientId =
      this.node.tryGetContext('cognitoAppClientId') ?? '2nntv51ltehca3jvr2cvhskjhl';
    const dbHost =
      this.node.tryGetContext('dbHost') ?? 'unity-appeals-dev-db.cwdecey86htz.us-east-1.rds.amazonaws.com';
    const dbPort = String(this.node.tryGetContext('dbPort') ?? 5432);
    const dbName = this.node.tryGetContext('dbName') ?? 'unity_appeals';
    const dbSecretArn =
      this.node.tryGetContext('dbSecretArn') ??
      'arn:aws:secretsmanager:us-east-1:726792844549:secret:rds!db-e9e0506a-eee0-4916-bf9f-0c3f20cedf95-Cqtgri';
    const dbSecretKmsKeyArn =
      this.node.tryGetContext('dbSecretKmsKeyArn') ??
      'arn:aws:kms:us-east-1:726792844549:key/9dd888a6-a6d4-4f60-9215-90b98123f48c';

    const dbSecret = secretsmanager.Secret.fromSecretCompleteArn(
      this,
      'ExistingDbCredentialsSecret',
      dbSecretArn
    );

    // ECR repo for the web image
    const webRepo = ecr.Repository.fromRepositoryName(this, 'WebRepo', 'unity-appeals-web');

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
        DATABASE_HOST: dbHost,
        DATABASE_PORT: dbPort,
        DATABASE_NAME: dbName,
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
        resources: [dbSecretKmsKeyArn],
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
      value: this.node.tryGetContext('existingLogsVpcEndpointId') ?? 'vpce-0ce79d655ff2c3126',
    });

    new cdk.CfnOutput(this, 'ExistingSecretsManagerVpcEndpointId', {
      value: this.node.tryGetContext('existingSecretsManagerVpcEndpointId') ?? 'vpce-0a7aa949562b1cfc5',
    });

    new cdk.CfnOutput(this, 'ExistingKmsVpcEndpointId', {
      value: this.node.tryGetContext('existingKmsVpcEndpointId') ?? 'vpce-0f59a30ceae685706',
    });

    new cdk.CfnOutput(this, 'ExistingEcrApiVpcEndpointId', {
      value: this.node.tryGetContext('existingEcrApiVpcEndpointId') ?? 'set-via-cdk-context',
    });

    new cdk.CfnOutput(this, 'ExistingEcrDockerVpcEndpointId', {
      value: this.node.tryGetContext('existingEcrDockerVpcEndpointId') ?? 'set-via-cdk-context',
    });

    new cdk.CfnOutput(this, 'ExistingStsVpcEndpointId', {
      value: this.node.tryGetContext('existingStsVpcEndpointId') ?? 'set-via-cdk-context',
    });

    new cdk.CfnOutput(this, 'ConfiguredCognitoUserPoolId', {
      value: cognitoUserPoolId,
    });

    new cdk.CfnOutput(this, 'ConfiguredCognitoAppClientId', {
      value: cognitoAppClientId,
    });

    new cdk.CfnOutput(this, 'WebLoadBalancerDnsName', {
      value: webService.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'WebServiceUrl', {
      value: `http://${webService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
