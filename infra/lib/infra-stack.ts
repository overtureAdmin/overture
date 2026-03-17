import * as cdk from 'aws-cdk-lib';
import { createHash } from 'node:crypto';
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
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';

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
  readonly dbSecretKmsKeyArn?: string | null;
  readonly existingLogsVpcEndpointId: string;
  readonly existingSecretsManagerVpcEndpointId: string;
  readonly existingKmsVpcEndpointId: string;
  readonly existingEcrApiVpcEndpointId: string | null;
  readonly existingEcrDockerVpcEndpointId: string | null;
  readonly existingStsVpcEndpointId: string | null;
  readonly cognitoUserPoolName: string;
  readonly cognitoAppClientName: string;
  readonly cognitoHostedUiDomainPrefix: string;
  readonly appBaseUrl: string;
  readonly tlsCertificateArn?: string | null;
  readonly n8nEnabled?: boolean;
  readonly n8nTlsCertificateArn?: string | null;
  readonly n8nCredentialsSecretName?: string | null;
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
      ? ec2.SecurityGroup.fromSecurityGroupId(this, 'ImportedOvertureAppSg', config.appSecurityGroupId, {
          mutable: true,
        })
      : new ec2.SecurityGroup(this, 'OvertureAppSg', {
          vpc,
          securityGroupName: config.appSecurityGroupName,
          description: 'Security group for Overture ECS app',
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
      selfSignUpEnabled: true,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
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

    const hostedUiDomain = userPool.addDomain('OvertureHostedUiDomain', {
      cognitoDomain: {
        domainPrefix: config.cognitoHostedUiDomainPrefix,
      },
    });

    const userPoolClient = userPool.addClient('UnityAppealsWebClient', {
      userPoolClientName: config.cognitoAppClientName,
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        callbackUrls: [`${config.appBaseUrl}/auth/callback`],
        logoutUrls: [`${config.appBaseUrl}/login`],
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
      },
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      preventUserExistenceErrors: true,
    });

    const cognitoRegion = cdk.Stack.of(this).region;
    const cognitoUserPoolId = userPool.userPoolId;
    const cognitoAppClientId = userPoolClient.userPoolClientId;
    const dbPort = String(config.dbPort);

    const isCompleteSecretArn = /:secret:[^:]+-[A-Za-z0-9]{6}$/.test(config.dbSecretArn);
    const dbSecret = isCompleteSecretArn
      ? secretsmanager.Secret.fromSecretCompleteArn(
          this,
          'ExistingDbCredentialsSecret',
          config.dbSecretArn
        )
      : secretsmanager.Secret.fromSecretNameV2(
          this,
          'ExistingDbCredentialsSecretByName',
          config.dbSecretArn.split(':secret:').at(-1) ?? config.dbSecretArn
        );
    const exportProcessorToken = createHash('sha256')
      .update(`${cdk.Stack.of(this).account}:${cdk.Stack.of(this).region}:${this.stackName}:export-processor:v1`)
      .digest('hex');
    const documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: `${this.stackName.toLowerCase()}-documents-${cdk.Stack.of(this).account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      autoDeleteObjects: false,
    });

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
        COGNITO_HOSTED_UI_DOMAIN: hostedUiDomain.baseUrl(),
        DATABASE_HOST: config.dbHost,
        DATABASE_PORT: dbPort,
        DATABASE_NAME: config.dbName,
        DATABASE_SSL: 'require',
        DEV_BYPASS_AUTH: 'false',
        BEDROCK_MODEL_ID: 'amazon.nova-lite-v1:0',
        DOCUMENTS_BUCKET_NAME: documentsBucket.bucketName,
        EXPORT_PROCESSOR_SHARED_SECRET: exportProcessorToken,
      },
      secrets: {
        DATABASE_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
        DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
      },
    });
    documentsBucket.grantReadWrite(taskDef.taskRole);

    // Secret retrieval for task startup also requires decrypt on the secret's KMS key.
    if (config.dbSecretKmsKeyArn) {
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
    }

    taskDef.addToTaskRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:Converse', 'bedrock:InvokeModel'],
        resources: [`arn:aws:bedrock:${cdk.Stack.of(this).region}::foundation-model/*`],
      })
    );

    // Web service behind an internet-facing ALB
    const webService = new ecsPatterns.ApplicationLoadBalancedFargateService(
      this,
      'OvertureWebService',
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

    webService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200-399',
    });

    if (config.tlsCertificateArn) {
      const httpListener = webService.listener.node.defaultChild as elbv2.CfnListener;
      httpListener.defaultActions = [
        {
          type: 'redirect',
          redirectConfig: {
            protocol: 'HTTPS',
            port: '443',
            statusCode: 'HTTP_301',
          },
        },
      ];

      const tlsCertificate = acm.Certificate.fromCertificateArn(
        this,
        'OvertureTlsCertificate',
        config.tlsCertificateArn
      );
      webService.loadBalancer.addListener('OvertureHttpsListener', {
        port: 443,
        protocol: elbv2.ApplicationProtocol.HTTPS,
        certificates: [tlsCertificate],
        open: true,
        defaultTargetGroups: [webService.targetGroup],
      });
    }

    const exportQueueSchedulerFn = new lambda.Function(this, 'ExportQueueSchedulerFn', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      timeout: cdk.Duration.seconds(30),
      description: `Periodic export queue trigger for ${this.stackName}`,
      environment: {
        PROCESSOR_URL: `http://${webService.loadBalancer.loadBalancerDnsName}/api/internal/exports/process`,
        PROCESSOR_TOKEN: exportProcessorToken,
      },
      code: lambda.Code.fromInline(`
        const http = require('node:http');
        const https = require('node:https');

        function postJson(url, body, token) {
          return new Promise((resolve, reject) => {
            const target = new URL(url);
            const payload = JSON.stringify(body);
            const lib = target.protocol === 'https:' ? https : http;
            const req = lib.request(
              target,
              {
                method: 'POST',
                headers: {
                  'content-type': 'application/json',
                  'content-length': Buffer.byteLength(payload),
                  'x-export-processor-token': token,
                },
              },
              (res) => {
                let text = '';
                res.setEncoding('utf8');
                res.on('data', (chunk) => {
                  text += chunk;
                });
                res.on('end', () => {
                  if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(text);
                  } else {
                    reject(new Error('scheduler received status ' + res.statusCode + ': ' + text));
                  }
                });
              }
            );
            req.on('error', reject);
            req.write(payload);
            req.end();
          });
        }

        exports.handler = async () => {
          const url = process.env.PROCESSOR_URL;
          const token = process.env.PROCESSOR_TOKEN;
          if (!url || !token) {
            throw new Error('missing required environment');
          }
          await postJson(url, { limit: 10 }, token);
          return { ok: true };
        };
      `),
    });

    new events.Rule(this, 'ExportQueueScheduleRule', {
      description: `Runs export queue processor every minute for ${this.stackName}`,
      schedule: events.Schedule.rate(cdk.Duration.minutes(1)),
      targets: [new eventsTargets.LambdaFunction(exportQueueSchedulerFn)],
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
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
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

    // ── n8n workflow orchestration service ────────────────────────────────────
    if (config.n8nEnabled) {
      const n8nCredentialsSecretName = config.n8nCredentialsSecretName ?? 'overture-prod-n8n-credentials';
      const n8nSecret = secretsmanager.Secret.fromSecretNameV2(
        this, 'N8nCredentialsSecret', n8nCredentialsSecretName
      );

      // Security group for n8n tasks
      const n8nSg = new ec2.SecurityGroup(this, 'N8nSg', {
        vpc,
        description: 'Security group for n8n ECS tasks',
        allowAllOutbound: true,
      });

      // Security group for n8n ALB
      const n8nAlbSg = new ec2.SecurityGroup(this, 'N8nAlbSg', {
        vpc,
        description: 'Security group for n8n ALB',
        allowAllOutbound: false,
      });
      n8nAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'HTTPS from internet');
      n8nAlbSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'HTTP redirect from internet');

      // Allow n8n ALB → tasks on port 5678
      n8nSg.addIngressRule(n8nAlbSg, ec2.Port.tcp(5678), 'ALB to n8n tasks');
      // Allow web app → n8n for webhook dispatch
      n8nSg.addIngressRule(appSg, ec2.Port.tcp(5678), 'Web service to n8n webhooks');

      // Allow n8n tasks to reach VPC endpoints (Secrets Manager, ECR, logs)
      new ec2.CfnSecurityGroupIngress(this, 'ExistingEndpointsSgFromN8nSg443', {
        groupId: endpointsSg.securityGroupId,
        sourceSecurityGroupId: n8nSg.securityGroupId,
        ipProtocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        description: 'Allow n8n tasks to access interface endpoints over TLS',
      });

      // n8n task definition (ARM64 — n8n official image is multi-arch)
      const n8nTaskDef = new ecs.FargateTaskDefinition(this, 'N8nTaskDef', {
        cpu: 512,
        memoryLimitMiB: 1024,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      });

      n8nTaskDef.addContainer('n8n', {
        image: ecs.ContainerImage.fromRegistry('n8nio/n8n:latest'),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: 'n8n',
          logRetention: this.toLogRetention(config.logRetentionDays),
        }),
        portMappings: [{ containerPort: 5678 }],
        environment: {
          N8N_HOST: 'n8n.oncologyexecutive.com',
          N8N_PORT: '5678',
          N8N_PROTOCOL: 'https',
          WEBHOOK_URL: 'https://n8n.oncologyexecutive.com/',
          N8N_BASIC_AUTH_ACTIVE: 'true',
          DB_TYPE: 'postgresdb',
          DB_POSTGRESDB_HOST: config.dbHost,
          DB_POSTGRESDB_PORT: String(config.dbPort),
          DB_POSTGRESDB_DATABASE: 'n8n',
          DB_POSTGRESDB_SSL: 'true',
          DB_POSTGRESDB_SSL_REJECT_UNAUTHORIZED: 'false',
          GENERIC_TIMEZONE: 'America/New_York',
          N8N_LOG_LEVEL: 'info',
          N8N_RUNNERS_ENABLED: 'true',
        },
        secrets: {
          N8N_BASIC_AUTH_USER: ecs.Secret.fromSecretsManager(n8nSecret, 'basicAuthUser'),
          N8N_BASIC_AUTH_PASSWORD: ecs.Secret.fromSecretsManager(n8nSecret, 'basicAuthPassword'),
          N8N_ENCRYPTION_KEY: ecs.Secret.fromSecretsManager(n8nSecret, 'encryptionKey'),
          DB_POSTGRESDB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
          DB_POSTGRESDB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
        },
      });

      // n8n ALB
      const n8nAlb = new elbv2.ApplicationLoadBalancer(this, 'N8nAlb', {
        vpc,
        internetFacing: true,
        securityGroup: n8nAlbSg,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      });

      const n8nTargetGroup = new elbv2.ApplicationTargetGroup(this, 'N8nTargetGroup', {
        vpc,
        port: 5678,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        healthCheck: {
          path: '/healthz',
          healthyHttpCodes: '200-399',
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(10),
        },
      });

      // HTTP listener — redirect to HTTPS once cert is ready, else forward
      if (config.n8nTlsCertificateArn) {
        n8nAlb.addListener('N8nHttpListener', {
          port: 80,
          defaultAction: elbv2.ListenerAction.redirect({
            protocol: 'HTTPS',
            port: '443',
            permanent: true,
          }),
        });
        const n8nCert = acm.Certificate.fromCertificateArn(
          this, 'N8nTlsCertificate', config.n8nTlsCertificateArn
        );
        n8nAlb.addListener('N8nHttpsListener', {
          port: 443,
          protocol: elbv2.ApplicationProtocol.HTTPS,
          certificates: [n8nCert],
          defaultTargetGroups: [n8nTargetGroup],
        });
      } else {
        n8nAlb.addListener('N8nHttpListener', {
          port: 80,
          defaultTargetGroups: [n8nTargetGroup],
        });
      }

      // n8n ECS service — starts at 0 tasks until DB is provisioned
      const n8nService = new ecs.FargateService(this, 'N8nService', {
        cluster,
        taskDefinition: n8nTaskDef,
        desiredCount: 0,
        securityGroups: [n8nSg],
        assignPublicIp: false,
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });
      n8nTargetGroup.addTarget(n8nService);

      // Grant n8n task access to the n8n credentials secret
      n8nSecret.grantRead(n8nTaskDef.executionRole!);
      dbSecret.grantRead(n8nTaskDef.executionRole!);

      new cdk.CfnOutput(this, 'N8nLoadBalancerDnsName', {
        value: n8nAlb.loadBalancerDnsName,
      });
      new cdk.CfnOutput(this, 'N8nBootstrapUser', {
        value: 'unityadmin',
      });
    }
    // ── end n8n ───────────────────────────────────────────────────────────────

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

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: documentsBucket.bucketName,
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
