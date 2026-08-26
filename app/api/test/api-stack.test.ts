import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ApiStack } from "../lib/api-stack";

describe("ApiStack", () => {
  it("creates an HTTP API with a GET /health route backed by a Lambda", () => {
    const app = new App();
    const stack = new ApiStack(app, "TestApiStack");
    const template = Template.fromStack(stack);

    template.resourceCountIs("AWS::ApiGatewayV2::Api", 1);
    template.resourceCountIs("AWS::ApiGatewayV2::Route", 1);
    template.hasResourceProperties("AWS::ApiGatewayV2::Route", {
      RouteKey: "GET /health",
    });
    template.resourceCountIs("AWS::Lambda::Function", 2);
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
});
