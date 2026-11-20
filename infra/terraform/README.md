# Infrastructure (Terraform)

The game's own hosting on AWS. The simulation runs in the browser, so the backend only stores
progress, shared designs and leaderboards. Everything is serverless and scales to zero, so an idle
environment costs close to nothing.

```
bootstrap/            One-time: remote state bucket, GitHub OIDC provider, CI roles (local state)
modules/
  static_site/        Private S3 bucket + CloudFront (Origin Access Control, security headers, SPA routing)
  data/               DynamoDB single table (on-demand, PITR, encryption, GSI1)
  auth/               Cognito user pool, PKCE web client, optional Google sign-in
  api/                HTTP API Gateway, JWT authorizer, one Lambda + least-privilege role per handler
  monitoring/         CloudWatch alarms and dashboard, SNS alerts, AWS Budgets alert
  stack/              Composes the modules into one environment
envs/
  dev/                Deployed automatically from main
  prod/               Deployed manually, behind a GitHub environment approval
```

## Cost guard rails

- DynamoDB on-demand, Lambda on arm64, HTTP API (not REST API), CloudFront `PriceClass_100`
- API Gateway throttling (50 req/s steady, 100 burst) caps the bill if someone hammers the API
- Log retention of 7 days in dev and 30 in prod
- An AWS Budgets alert per environment ($10 dev, $25 prod) at 80% actual and 100% forecast

## First-time setup

> Every `terraform apply` below creates real AWS resources. Review each plan first.

1. **Bootstrap** (once, with an admin profile):

   ```bash
   cd infra/terraform/bootstrap
   cp terraform.tfvars.example terraform.tfvars   # set github_repository
   terraform init && terraform plan -out tfplan
   terraform apply tfplan
   ```

   Note the outputs `state_bucket` and `role_arns`.

2. **GitHub settings** for the repository:
   - Variables: `AWS_REGION`, `TF_STATE_BUCKET`, `AWS_PLAN_ROLE_ARN`, `AWS_DEPLOY_ROLE_ARN_DEV`, `AWS_DEPLOY_ROLE_ARN_PROD`
   - Optional variable `ALERT_EMAIL`
   - Environments `dev` and `prod`; add required reviewers to `prod`

   No AWS access keys are stored anywhere: workflows exchange GitHub's OIDC token for
   short-lived credentials, and each role's trust policy only accepts this repository.

3. **Lock provider versions** for every platform you use, and commit the lock files:

   ```bash
   cd infra/terraform/envs/dev
   terraform init -backend=false
   terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64
   ```

4. **Deploy**: merge to `main` and the `Deploy` workflow plans and applies `dev`. Run it manually
   with `environment: prod` to deploy prod (pauses for approval).

## Working locally

```bash
pnpm --filter @cloud-architect/api build          # bundles the Lambdas into services/api/dist
cd infra/terraform/envs/dev
cp backend.hcl.example backend.hcl                 # set the state bucket
terraform init -backend-config=backend.hcl
terraform plan
```

The static site is uploaded by the deploy workflow (`aws s3 sync` + CloudFront invalidation),
not by Terraform, so infrastructure and application releases stay independent.

## Activate the cost allocation tag

The budget counts resources tagged `Stack=<stack name>`. Activate `Stack` once under
Billing → Cost allocation tags, or remove the `cost_filter` to budget the whole account.
