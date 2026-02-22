#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { InfraEnvironmentConfig, InfraStack } from '../lib/infra-stack';

type AppContext = {
  environments?: Record<string, InfraEnvironmentConfig>;
};

const app = new cdk.App();
const deployEnvironment =
  (app.node.tryGetContext('environment') as string | undefined) ??
  process.env.DEPLOY_ENV ??
  'dev';
const stackId = deployEnvironment === 'dev' ? 'InfraStack' : `InfraStack-${deployEnvironment}`;
const context = app.node.tryGetContext('environments') as AppContext['environments'];
const config = context?.[deployEnvironment];

if (!config) {
  throw new Error(
    `Missing config for environment "${deployEnvironment}". Define it in cdk.json under context.environments.${deployEnvironment}.`
  );
}

new InfraStack(app, stackId, {
  env: {
    account: config.account,
    region: config.region,
  },
  config,
});
