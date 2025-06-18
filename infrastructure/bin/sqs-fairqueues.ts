#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkSqsFairQueuesStack } from '../lib/sqs-fairqueues-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag'
import {Aspects} from "aws-cdk-lib";

const app = new cdk.App();
Aspects.of(app).add((new AwsSolutionsChecks({ verbose: true })));
const stack = new CdkSqsFairQueuesStack(app, 'CdkSqsFairQueuesStack', {});

// Add suppressions for AwsSolutions-IAM4: Using AWS managed policies
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM4', reason: 'Using AWS managed policies for demo purposes' }
]);
// Add suppressions for AwsSolutions-APIG1: REST API does not have request validation enabled
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-APIG1', reason: 'Request validation not needed for demo purposes' }
]);
// Add suppressions for AwsSolutions-APIG2: API does not have access logging enabled
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-APIG2', reason: 'Access logging not needed for demo purposes' }
]);
// Add suppressions for AwsSolutions-APIG3: REST API stage is not associated with AWS WAFv2
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-APIG3', reason: 'WAF not needed for demo purposes' }
]);
// Add suppressions for AwsSolutions-APIG4: API Gateway should have an authorizer configured
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-APIG4', reason: 'Using API keys for authentication is sufficient for demo purposes' }
]);
// Add suppressions for AwsSolutions-APIG6: API Gateway should have an authorizer configured
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-APIG6', reason: 'Cloudwatch Logging not needed for demo purposes' }
]);
// Add suppressions for AwsSolutions-COG4: Cognito User pool should have advanced security enabled
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-COG4', reason: 'Not using Cognito, using API keys for demo purposes' }
]);
// Add suppressions for AwsSolutions-IAM5: IAM policy allows '*' in resource
NagSuppressions.addStackSuppressions(stack, [
  { id: 'AwsSolutions-IAM5', reason: 'CloudWatch PutMetricData requires * resource - already restricted to account' }
]);