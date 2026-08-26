import { Stack, type StackProps, CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
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

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "api",
    });

    const healthFunction = new NodejsFunction(this, "HealthFunction", {
      entry: path.join(__dirname, "..", "lambda", "health.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
    });

    httpApi.addRoutes({
      path: "/health",
      methods: [HttpMethod.GET],
      integration: new HttpLambdaIntegration(
        "HealthIntegration",
        healthFunction,
      ),
    });

    new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
  }
}
