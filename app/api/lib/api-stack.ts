import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "DbVpc", {
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "isolated",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    vpc.addInterfaceEndpoint("SecretsManagerEndpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    const dbCluster = new rds.DatabaseCluster(this, "DbCluster", {
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_16_13,
      }),
      writer: rds.ClusterInstance.serverlessV2("Writer"),
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 1,
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromGeneratedSecret("appadmin"),
      defaultDatabaseName: "app",
      enableDataApi: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const dbSecret = dbCluster.secret!;

    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false,
      standardAttributes: {
        fullname: { required: false, mutable: true },
      },
      customAttributes: {
        role: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const userPoolClient = userPool.addClient("UserPoolClient", {
      generateSecret: true,
      authFlows: { userPassword: true },
    });

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "api",
    });

    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(__dirname, "..", "lambda", "health.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.seconds(25),
      environment: {
        DB_RESOURCE_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_NAME: "app",
      },
    });

    dbCluster.grantDataApiAccess(healthFunction);

    const registerFunction = new NodejsFunction(this, "RegisterFunction", {
      entry: path.join(__dirname, "..", "lambda", "auth-register.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.seconds(25),
      environment: {
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        DB_RESOURCE_ARN: dbCluster.clusterArn,
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_NAME: "app",
      },
    });

    dbCluster.grantDataApiAccess(registerFunction);
    registerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
        ],
        resources: [userPool.userPoolArn],
      }),
    );

    const loginFunction = new NodejsFunction(this, "LoginFunction", {
      entry: path.join(__dirname, "..", "lambda", "auth-login.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      timeout: Duration.seconds(25),
      environment: {
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_CLIENT_SECRET: userPoolClient.userPoolClientSecret.unsafeUnwrap(),
      },
    });

    const migrateFunction = new NodejsFunction(this, "MigrateFunction", {
      entry: path.join(__dirname, "..", "lambda", "migrate.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      functionName: "api-migrate",
      timeout: Duration.minutes(5),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        DB_HOST: dbCluster.clusterEndpoint.hostname,
        DB_PORT: dbCluster.clusterEndpoint.port.toString(),
        DB_NAME: "app",
        DB_SECRET_ARN: dbSecret.secretArn,
      },
      bundling: {
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            return [
              `mkdir -p ${outputDir}/db`,
              `cp -r ${inputDir}/db/migrations ${outputDir}/db/migrations`,
            ];
          },
          beforeInstall(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
        },
      },
    });

    dbSecret.grantRead(migrateFunction);
    dbCluster.connections.allowDefaultPortFrom(
      migrateFunction,
      "Allow migration Lambda to reach Aurora",
    );

    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "HealthIntegration",
        healthFunction,
      ),
    });

    httpApi.addRoutes({
      path: "/auth/register",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "RegisterIntegration",
        registerFunction,
      ),
    });

    httpApi.addRoutes({
      path: "/auth/login",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration("LoginIntegration", loginFunction),
    });

    new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "DbClusterEndpoint", {
      value: dbCluster.clusterEndpoint.hostname,
    });
    new CfnOutput(this, "MigrateFunctionName", {
      value: migrateFunction.functionName,
    });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
  }
}
