import { Duration } from "aws-cdk-lib";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import type { DatabaseConstruct } from "./database";

export const LAMBDA_RUNTIME = Runtime.NODEJS_24_X;
export const DEFAULT_LAMBDA_TIMEOUT = Duration.seconds(25);

export interface BaseApiConstructProps {
  lambdaDir: string;
  database: DatabaseConstruct;
}
