import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack";

describe("ApiStack", () => {
  it("creates an HTTP API with a GET /health route backed by a Lambda", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /health",
    });
  });

  it("provisions an Aurora Serverless v2 Postgres cluster with Data API enabled, in an isolated-subnet VPC with no NAT gateways", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::EC2::VPC", 1);
    template.resourceCountIs("AWS::EC2::NatGateway", 0);

    template.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      EnableHttpEndpoint: true,
      ServerlessV2ScalingConfiguration: {
        MinCapacity: 0,
        MaxCapacity: 1,
      },
    });

    template.hasResourceProperties("AWS::EC2::VPCEndpoint", {
      VpcEndpointType: "Interface",
      ServiceName: {
        "Fn::Join": [
          "",
          Match.arrayWith([Match.stringLikeRegexp("secretsmanager$")]),
        ],
      },
    });
  });

  it("grants HealthFunction Data API access without placing it in a VPC", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      Handler: "index.handler",
      Environment: {
        Variables: Match.objectLike({
          DB_NAME: "app",
          DB_RESOURCE_ARN: Match.anyValue(),
          DB_SECRET_ARN: Match.anyValue(),
        }),
      },
      VpcConfig: Match.absent(),
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["rds-data:ExecuteStatement"]),
          }),
        ]),
      },
    });
  });

  it("runs the migration Lambda inside the Aurora VPC with a fixed name and Secrets Manager read access", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Lambda::Function", {
      FunctionName: "api-migrate",
      VpcConfig: Match.objectLike({
        SubnetIds: Match.anyValue(),
      }),
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith(["secretsmanager:GetSecretValue"]),
          }),
        ]),
      },
    });

    template.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      IpProtocol: "tcp",
      Description: "Allow migration Lambda to reach Aurora",
      FromPort: Match.anyValue(),
      ToPort: Match.anyValue(),
    });
  });

  it("provisions a Cognito User Pool with a secret-enabled app client supporting USER_PASSWORD_AUTH and a custom role attribute", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.hasResourceProperties("AWS::Cognito::UserPool", {
      AdminCreateUserConfig: Match.objectLike({
        AllowAdminCreateUserOnly: true,
      }),
      Schema: Match.arrayWith([
        Match.objectLike({
          AttributeDataType: "String",
          Name: "role",
        }),
      ]),
    });

    template.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: true,
      ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_PASSWORD_AUTH"]),
    });
  });

  it("wires POST /auth/register and POST /auth/login to dedicated Lambdas outside the VPC", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    // 4 handler Lambdas (Health, Migrate, Register, Login) + 1 CDK-generated
    // AwsCustomResource singleton provider Lambda, created because
    // UserPoolClient.userPoolClientSecret reads the secret via a
    // DescribeUserPoolClient custom resource (CloudFormation does not expose
    // ClientSecret as a Fn::GetAtt attribute).
    template.resourceCountIs("AWS::Lambda::Function", 5);

    // Replaces an earlier resourceCountIs("AWS::ApiGatewayV2::Route", 1),
    // which went stale once /auth/register and /auth/login were added
    // alongside the original /health route.
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 3);

    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /auth/register",
    });
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "POST /auth/login",
    });

    template.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: Match.arrayWith([
              "cognito-idp:AdminCreateUser",
              "cognito-idp:AdminSetUserPassword",
            ]),
            Resource: {
              "Fn::GetAtt": [Match.stringLikeRegexp("^UserPool"), "Arn"],
            },
          }),
        ]),
      },
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          COGNITO_USER_POOL_ID: Match.anyValue(),
          DB_RESOURCE_ARN: Match.anyValue(),
        }),
      }),
      VpcConfig: Match.absent(),
    });

    template.hasResourceProperties("AWS::Lambda::Function", {
      Environment: Match.objectLike({
        Variables: Match.objectLike({
          COGNITO_CLIENT_ID: Match.anyValue(),
          COGNITO_CLIENT_SECRET: Match.anyValue(),
        }),
      }),
      VpcConfig: Match.absent(),
    });
  });

  it("LoginFunction has no Cognito admin IAM policy and no Data API grant", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    // Find LoginFunction's logical id and its role's logical id, then confirm
    // no IAM::Policy attached to that role grants either the Cognito admin
    // actions (Register's grant) or the Data API action (Health/Register's
    // grant) — those belong to other functions' roles, not Login's.
    const functions = template.findResources("AWS::Lambda::Function");
    const loginFunctionId = Object.keys(functions).find((id) =>
      id.startsWith("LoginFunction"),
    );
    expect(loginFunctionId).toBeDefined();

    const loginRoleRef =
      functions[loginFunctionId!].Properties.Role["Fn::GetAtt"][0];

    const policies = template.findResources("AWS::IAM::Policy");
    for (const policy of Object.values(policies)) {
      const roles: unknown[] = policy.Properties.Roles ?? [];
      const attachedToLogin = roles.some(
        (role) =>
          typeof role === "object" &&
          role !== null &&
          "Ref" in (role as Record<string, unknown>) &&
          (role as Record<string, unknown>).Ref === loginRoleRef,
      );
      if (!attachedToLogin) continue;

      const statements: Array<{ Action?: unknown }> =
        policy.Properties.PolicyDocument.Statement;
      for (const statement of statements) {
        const actions = Array.isArray(statement.Action)
          ? statement.Action
          : [statement.Action];
        expect(actions).not.toEqual(
          expect.arrayContaining(["cognito-idp:AdminCreateUser"]),
        );
        expect(actions).not.toEqual(
          expect.arrayContaining(["rds-data:ExecuteStatement"]),
        );
      }
    }
  });
});
