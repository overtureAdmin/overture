import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';

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
    });

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

    new cdk.CfnOutput(this, 'WebLoadBalancerDnsName', {
      value: webService.loadBalancer.loadBalancerDnsName,
    });

    new cdk.CfnOutput(this, 'WebServiceUrl', {
      value: `http://${webService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}
