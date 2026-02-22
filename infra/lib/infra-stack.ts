import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';

export interface InfraEnvironmentConfig {
  readonly account: string;
  readonly region: string;
  readonly vpcName?: string;
  readonly appSecurityGroupName: string;
  readonly appSecurityGroupId?: string;
  readonly albSecurityGroupId?: string;
  readonly endpointSecurityGroupId: string;
  readonly clusterName: string;
  readonly ecrRepositoryName: string;
  readonly dbInstanceIdentifier: string;
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
  readonly alarmEmailRecipients: string[];
  readonly rdsBackupRetentionDays: number;
  readonly rdsPreferredBackupWindow: string;
  readonly rdsPreferredMaintenanceWindow: string;
  readonly logRetentionDays: number;
  readonly enablePerformanceInsights: boolean;
}

interface InfraStackProps extends cdk.StackProps {
  readonly config: InfraEnvironmentConfig;
  readonly vpc?: ec2.IVpc;
}

export class InfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: InfraStackProps) {
    super(scope, id, props);
    const { config } = props;

    const vpc = props.vpc ??
      ec2.Vpc.fromLookup(this, 'ExistingVpc', config.vpcName ? { vpcName: config.vpcName } : {});

    // App Security Group (ECS tasks) - created/managed by CDK unless imported.
    const appSg = config.appSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedUnityAppealsAppSg', config.appSecurityGroupId, {
          mutable: true,
        })
      : new ec2.SecurityGroup(this, 'UnityAppealsAppSg', {
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
    const albSg = config.albSecurityGroupId
      ? ec2.SecurityGroup.fromSecurityGroupId(this, 'ExistingAlbSg', config.albSecurityGroupId, {
          mutable: true,
        })
      : undefined;

    // Ensure ALB -> App allowed on port 3000
    if (albSg) {
      appSg.addIngressRule(albSg, ec2.Port.tcp(3000), 'Allow ALB to reach app on 3000');
    }

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
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'web',
        logRetention: this.toLogRetention(config.logRetentionDays),
      }),
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
        BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
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

    taskDef.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:Converse', 'bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/*`],
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
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        securityGroups: [appSg],
        taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        taskDefinition: taskDef,
      }
    );

    // Add the pre-existing ALB SG (HTTPS allowed there)
    if (albSg) {
      webService.loadBalancer.addSecurityGroup(albSg);
    }
    webService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200-399',
    });
    const alarmTopic = new sns.Topic(this, 'OpsAlarmTopic', {
      topicName: `${this.stackName.toLowerCase()}-alarms`,
      displayName: `${this.stackName} alarms`,
    });

    for (const email of config.alarmEmailRecipients) {
      alarmTopic.addSubscription(new snsSubscriptions.EmailSubscription(email));
    }

    const alarmAction = new cloudwatchActions.SnsAction(alarmTopic);

    const albTarget5xxAlarm = new cloudwatch.Alarm(this, 'AlbTarget5xxAlarm', {
      alarmName: `${this.stackName}-alb-target-5xx`,
      alarmDescription: 'ALB target group is returning elevated 5xx responses.',
      metric: webService.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: cdk.Duration.minutes(5),
        statistic: 'sum',
      }),
      threshold: 5,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    albTarget5xxAlarm.addAlarmAction(alarmAction);
    albTarget5xxAlarm.addOkAction(alarmAction);

    const ecsRunningTaskAlarm = new cloudwatch.Alarm(this, 'EcsRunningTaskAlarm', {
      alarmName: `${this.stackName}-ecs-running-tasks-low`,
      alarmDescription: 'ECS service has fewer running tasks than expected.',
      metric: webService.service.metric('RunningTaskCount', {
        period: cdk.Duration.minutes(1),
        statistic: 'minimum',
      }),
      threshold: 1,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    ecsRunningTaskAlarm.addAlarmAction(alarmAction);
    ecsRunningTaskAlarm.addOkAction(alarmAction);

    const rdsCpuHighAlarm = new cloudwatch.Alarm(this, 'RdsCpuHighAlarm', {
      alarmName: `${this.stackName}-rds-cpu-high`,
      alarmDescription: 'RDS CPU utilization is persistently high.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBInstanceIdentifier: config.dbInstanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    rdsCpuHighAlarm.addAlarmAction(alarmAction);
    rdsCpuHighAlarm.addOkAction(alarmAction);

    const rdsFreeStorageLowAlarm = new cloudwatch.Alarm(this, 'RdsFreeStorageLowAlarm', {
      alarmName: `${this.stackName}-rds-free-storage-low`,
      alarmDescription: 'RDS free storage is low.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'FreeStorageSpace',
        dimensionsMap: {
          DBInstanceIdentifier: config.dbInstanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'average',
      }),
      threshold: 5 * 1024 * 1024 * 1024,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
    });
    rdsFreeStorageLowAlarm.addAlarmAction(alarmAction);
    rdsFreeStorageLowAlarm.addOkAction(alarmAction);

    const rdsConnectionsHighAlarm = new cloudwatch.Alarm(this, 'RdsConnectionsHighAlarm', {
      alarmName: `${this.stackName}-rds-connections-high`,
      alarmDescription: 'RDS active connections are high.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'DatabaseConnections',
        dimensionsMap: {
          DBInstanceIdentifier: config.dbInstanceIdentifier,
        },
        period: cdk.Duration.minutes(5),
        statistic: 'average',
      }),
      threshold: 80,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
    });
    rdsConnectionsHighAlarm.addAlarmAction(alarmAction);
    rdsConnectionsHighAlarm.addOkAction(alarmAction);

    new cdk.CfnOutput(this, 'AppSecurityGroupId', {
      value: appSg.securityGroupId,
    });

    new cdk.CfnOutput(this, 'AlbSecurityGroupId', {
      value: albSg?.securityGroupId ?? webService.loadBalancer.connections.securityGroups[0].securityGroupId,
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

  private toLogRetention(days: number): logs.RetentionDays {
    const map: Record<number, logs.RetentionDays> = {
      1: logs.RetentionDays.ONE_DAY,
      3: logs.RetentionDays.THREE_DAYS,
      5: logs.RetentionDays.FIVE_DAYS,
      7: logs.RetentionDays.ONE_WEEK,
      14: logs.RetentionDays.TWO_WEEKS,
      30: logs.RetentionDays.ONE_MONTH,
      60: logs.RetentionDays.TWO_MONTHS,
      90: logs.RetentionDays.THREE_MONTHS,
      120: logs.RetentionDays.FOUR_MONTHS,
      150: logs.RetentionDays.FIVE_MONTHS,
      180: logs.RetentionDays.SIX_MONTHS,
      365: logs.RetentionDays.ONE_YEAR,
      400: logs.RetentionDays.THIRTEEN_MONTHS,
      545: logs.RetentionDays.EIGHTEEN_MONTHS,
      731: logs.RetentionDays.TWO_YEARS,
      1827: logs.RetentionDays.FIVE_YEARS,
      3653: logs.RetentionDays.TEN_YEARS,
    };
    return map[days] ?? logs.RetentionDays.ONE_MONTH;
  }
}
