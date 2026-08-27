import { Stack, type StackProps, CfnOutput } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { CorsHttpMethod, HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import * as path from "path";
import { DatabaseConstruct } from "./constructs/database";
import { AuthConstruct } from "./constructs/auth";
import { HealthApi } from "./constructs/health-api";
import { AuthApi } from "./constructs/auth-api";
import { MigrateConstruct } from "./constructs/migrate";

export interface ApiStackProps extends StackProps {
  /** Deployed client origins to allow, in addition to the local dev server. */
  additionalAllowedOrigins?: string[];
}

export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props?: ApiStackProps) {
    super(scope, id, props);

    const lambdaDir = path.join(__dirname, "..", "lambda");

    const database = new DatabaseConstruct(this, "Database");
    const auth = new AuthConstruct(this, "Auth");

    const httpApi = new HttpApi(this, "HttpApi", {
      apiName: "api",
      corsPreflight: {
        allowOrigins: [
          "http://localhost:3000",
          ...(props?.additionalAllowedOrigins ?? []),
        ],
        allowMethods: [CorsHttpMethod.GET, CorsHttpMethod.POST],
        allowHeaders: ["Content-Type"],
      },
    });

    new HealthApi(this, "HealthApi", { httpApi, lambdaDir, database });
    new AuthApi(this, "AuthApi", { httpApi, lambdaDir, database, auth });
    const migrate = new MigrateConstruct(this, "Migrate", {
      lambdaDir,
      database,
    });

    new CfnOutput(this, "HttpApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "DbClusterEndpoint", {
      value: database.cluster.clusterEndpoint.hostname,
    });
    new CfnOutput(this, "MigrateFunctionName", {
      value: migrate.function.functionName,
    });
    new CfnOutput(this, "UserPoolId", { value: auth.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", {
      value: auth.userPoolClient.userPoolClientId,
    });
  }
}
