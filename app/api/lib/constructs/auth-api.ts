import { Construct } from "constructs";
import { HttpApi, HttpMethod } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { DB_NAME } from "./database";
import { AuthConstruct } from "./auth";
import {
  BaseApiConstructProps,
  DEFAULT_LAMBDA_TIMEOUT,
  LAMBDA_RUNTIME,
} from "./shared";

export interface AuthApiProps extends BaseApiConstructProps {
  httpApi: HttpApi;
  auth: AuthConstruct;
}

export class AuthApi extends Construct {
  constructor(scope: Construct, id: string, props: AuthApiProps) {
    super(scope, id);

    const registerFunction = new NodejsFunction(this, "RegisterFunction", {
      entry: path.join(props.lambdaDir, "auth-register.ts"),
      handler: "handler",
      runtime: LAMBDA_RUNTIME,
      timeout: DEFAULT_LAMBDA_TIMEOUT,
      environment: {
        COGNITO_USER_POOL_ID: props.auth.userPool.userPoolId,
        DB_RESOURCE_ARN: props.database.cluster.clusterArn,
        DB_SECRET_ARN: props.database.secret.secretArn,
        DB_NAME,
      },
      bundling: {
        externalModules: [],
      },
    });

    props.database.cluster.grantDataApiAccess(registerFunction);
    registerFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "cognito-idp:AdminCreateUser",
          "cognito-idp:AdminSetUserPassword",
        ],
        resources: [props.auth.userPool.userPoolArn],
      }),
    );

    const loginFunction = new NodejsFunction(this, "LoginFunction", {
      entry: path.join(props.lambdaDir, "auth-login.ts"),
      handler: "handler",
      runtime: LAMBDA_RUNTIME,
      timeout: DEFAULT_LAMBDA_TIMEOUT,
      environment: {
        COGNITO_CLIENT_ID: props.auth.userPoolClient.userPoolClientId,
        COGNITO_CLIENT_SECRET:
          props.auth.userPoolClient.userPoolClientSecret.unsafeUnwrap(),
      },
      bundling: {
        externalModules: [],
      },
    });

    props.httpApi.addRoutes({
      path: "/auth/register",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "RegisterIntegration",
        registerFunction,
      ),
    });

    props.httpApi.addRoutes({
      path: "/auth/login",
      methods: [HttpMethod.POST],
      integration: new HttpLambdaIntegration(
        "LoginIntegration",
        loginFunction,
      ),
    });
  }
}
