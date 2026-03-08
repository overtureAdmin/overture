#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
CLUSTER="unity-appeals-staging-v2-cluster"
TASK_DEF="InfraStackstagingv2WebTaskDef0200C998:9"
SUBNETS="subnet-08f03cb0eff4f94db,subnet-0606c86d111c4c0c5"
SECURITY_GROUP="sg-0743a60f5887871c0"
SECRET_ID="unity-appeals-staging-v2-migrator-db-credentials"

ORGS="${ORGS:-4}"
USERS_PER_ORG="${USERS_PER_ORG:-4}"
PATIENTS_PER_USER="${PATIENTS_PER_USER:-5}"
PREFIX="${PREFIX:-stgtest}"

echo "Fetching DB secret from Secrets Manager (${SECRET_ID})..."
secret_json="$(aws secretsmanager get-secret-value \
  --secret-id "${SECRET_ID}" \
  --region "${REGION}" \
  --query SecretString \
  --output text)"

db_host="$(echo "${secret_json}" | jq -r '.host')"
db_port="$(echo "${secret_json}" | jq -r '.port|tostring')"
db_name="$(echo "${secret_json}" | jq -r '.dbname')"
db_user="$(echo "${secret_json}" | jq -r '.username')"
db_pass="$(echo "${secret_json}" | jq -r '.password')"
enc_user="$(printf '%s' "${db_user}" | jq -sRr @uri)"
enc_pass="$(printf '%s' "${db_pass}" | jq -sRr @uri)"
db_url="postgres://${enc_user}:${enc_pass}@${db_host}:${db_port}/${db_name}"

echo "Launching one-off ECS seed task..."
overrides="$(jq -cn \
  --arg dburl "${db_url}" \
  --arg orgs "${ORGS}" \
  --arg users "${USERS_PER_ORG}" \
  --arg patients "${PATIENTS_PER_USER}" \
  --arg prefix "${PREFIX}" \
  '{
    containerOverrides: [
      {
        name: "web",
        command: [
          "npm","run","seed:synthetic","--",
          "--orgs",$orgs,
          "--users-per-org",$users,
          "--patients-per-user",$patients,
          "--prefix",$prefix
        ],
        environment: [
          {name:"DATABASE_URL",value:$dburl},
          {name:"DATABASE_SSL",value:"require"}
        ]
      }
    ]
  }')"

task_arn="$(aws ecs run-task \
  --cluster "${CLUSTER}" \
  --launch-type FARGATE \
  --task-definition "${TASK_DEF}" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SECURITY_GROUP}],assignPublicIp=DISABLED}" \
  --overrides "${overrides}" \
  --region "${REGION}" \
  --query 'tasks[0].taskArn' \
  --output text)"

echo "Task ARN: ${task_arn}"
echo "Waiting for task to stop..."
aws ecs wait tasks-stopped --cluster "${CLUSTER}" --tasks "${task_arn}" --region "${REGION}"

echo "Task result:"
aws ecs describe-tasks \
  --cluster "${CLUSTER}" \
  --tasks "${task_arn}" \
  --region "${REGION}" \
  --query 'tasks[0].containers[0].[name,lastStatus,exitCode,reason]' \
  --output table

echo "Done."
