import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
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
    template.resourceCountIs("AWS::Lambda::Function", 1);
  });
});
