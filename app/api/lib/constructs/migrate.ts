import { Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as path from "path";
import { DB_NAME } from "./database";
import { BaseApiConstructProps, LAMBDA_RUNTIME } from "./shared";

export type MigrateConstructProps = BaseApiConstructProps;

export class MigrateConstruct extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: MigrateConstructProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, "MigrateFunction", {
      entry: path.join(props.lambdaDir, "migrate.ts"),
      handler: "handler",
      runtime: LAMBDA_RUNTIME,
      functionName: "api-migrate",
      timeout: Duration.minutes(5),
      vpc: props.database.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      environment: {
        DB_HOST: props.database.cluster.clusterEndpoint.hostname,
        DB_PORT: props.database.cluster.clusterEndpoint.port.toString(),
        DB_NAME,
        DB_SECRET_ARN: props.database.secret.secretArn,
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

    props.database.secret.grantRead(this.function);
    props.database.cluster.connections.allowDefaultPortFrom(
      this.function,
      "Allow migration Lambda to reach Aurora",
    );
  }
}
