#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraEnvironmentConfig, InfraStack } from '../lib/infra-stack';
import { NetworkStack, StagingNetworkConfig } from '../lib/network-stack';

type AppContext = {
  environments?: Record<string, InfraEnvironmentConfig>;
  stagingNetwork?: StagingNetworkConfig;
};

const app = new cdk.App();
const deployEnvironment =
  (app.node.tryGetContext('environment') as string | undefined) ??
  process.env.DEPLOY_ENV ??
  'dev';
const stackId =
  deployEnvironment === 'dev'
    ? 'InfraStack'
    : deployEnvironment === 'staging'
      ? 'InfraStack-staging-v2'
      : `InfraStack-${deployEnvironment}`;
const context = app.node.tryGetContext('environments') as AppContext['environments'];
const baseConfig = context?.[deployEnvironment];

if (!baseConfig) {
  throw new Error(
    `Missing config for environment "${deployEnvironment}". Define it in cdk.json under context.environments.${deployEnvironment}.`
  );
}

if (deployEnvironment === 'staging') {
  const networkConfig = app.node.tryGetContext('stagingNetwork') as AppContext['stagingNetwork'];
  if (!networkConfig) {
    throw new Error('Missing context.stagingNetwork in cdk.json.');
  }

  const networkStack = new NetworkStack(app, 'NetworkStack-staging', {
    env: {
      account: networkConfig.account,
      region: networkConfig.region,
    },
    config: networkConfig,
  });

  const stagingConfig: InfraEnvironmentConfig = {
    ...baseConfig,
    vpcName: undefined,
    appSecurityGroupId: networkStack.appSecurityGroup.securityGroupId,
    albSecurityGroupId: undefined,
    endpointSecurityGroupId: networkStack.endpointSecurityGroup.securityGroupId,
    dbInstanceIdentifier: networkStack.dbInstance.instanceIdentifier,
    dbHost: networkStack.dbInstance.dbInstanceEndpointAddress,
    dbSecretArn: networkStack.dbSecret.secretArn,
    dbSecretKmsKeyArn: networkStack.dbSecretKmsKey.keyArn,
    existingLogsVpcEndpointId: networkStack.logsEndpoint.vpcEndpointId,
    existingSecretsManagerVpcEndpointId: networkStack.secretsManagerEndpoint.vpcEndpointId,
    existingKmsVpcEndpointId: networkStack.kmsEndpoint.vpcEndpointId,
    existingEcrApiVpcEndpointId: null,
    existingEcrDockerVpcEndpointId: null,
    existingStsVpcEndpointId: null,
  };

  const infraStack = new InfraStack(app, stackId, {
    env: {
      account: stagingConfig.account,
      region: stagingConfig.region,
    },
    config: stagingConfig,
    vpc: networkStack.vpc,
  });
  infraStack.addDependency(networkStack);
} else {
  new InfraStack(app, stackId, {
    env: {
      account: baseConfig.account,
      region: baseConfig.region,
    },
    config: baseConfig,
  });
}
