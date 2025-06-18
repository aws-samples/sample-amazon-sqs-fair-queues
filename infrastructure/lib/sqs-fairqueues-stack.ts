import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import {Fn} from "aws-cdk-lib";
import {ConcreteWidget, GraphWidgetProps, LegendPosition, Unit} from "aws-cdk-lib/aws-cloudwatch";

export class CdkSqsFairQueuesStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a Dead Letter Queue
    const dlq = new sqs.Queue(this, 'DeadLetterQueue', {
      retentionPeriod: cdk.Duration.days(1), // Keep messages for 14 days
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true 
    });

    // Create the main queue with DLQ and SSL enabled
    const queue = new sqs.Queue(this, 'FairQueue', {
      visibilityTimeout: cdk.Duration.seconds(200),
      retentionPeriod: cdk.Duration.days(1),
      deadLetterQueue: {
        queue: dlq,
        maxReceiveCount: 10,
      },
      encryption: sqs.QueueEncryption.SQS_MANAGED, 
      enforceSSL: true 
    });

    const producerLambda = new lambda.Function(this, 'ProducerLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../app/producer'),
      timeout: cdk.Duration.seconds(10),
      reservedConcurrentExecutions: 1,
      memorySize: 1024,
      environment: {
        QUEUE_URL: queue.queueUrl,
      },
    });

    queue.grantSendMessages(producerLambda);

    const api = new apigateway.RestApi(this, 'ProducerApi', {
      restApiName: 'Producer API',
      deployOptions: {
        stageName: 'prod',
      },
      // Enable API key requirement for all methods
      defaultMethodOptions: {
        apiKeyRequired: true
      }
    });

    // Create API key and usage plan
    const apiKey = new apigateway.ApiKey(this, 'FairQueueApiKey', {
      apiKeyName: 'fair-queue-api-key',
      description: 'API Key for Fair Queue API',
      enabled: true,
    });

    const usagePlan = new apigateway.UsagePlan(this, 'FairQueueUsagePlan', {
      name: 'FairQueueUsagePlan',
      apiStages: [
        {
          api,
          stage: api.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 10,
        burstLimit: 20,
      },
    });

    usagePlan.addApiKey(apiKey);

    const lambdaIntegration = new apigateway.LambdaIntegration(producerLambda);

    const resourceLoad = api.root.addResource('generateLoad');
    resourceLoad.addMethod('POST', lambdaIntegration, {
      methodResponses: [{ statusCode: '200' }],
      apiKeyRequired: true, // Explicitly require API key for this method
    });

    api.addGatewayResponse('AccessDeniedResponse', {
      type: apigateway.ResponseType.UNAUTHORIZED,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    const consumerLambda = new lambda.Function(this, 'ConsumerLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../app/consumer'),
      timeout: cdk.Duration.minutes(3),
      environment: {
        QUEUE_URL: queue.queueUrl,
      },
    });

    consumerLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudwatch:PutMetricData'],
      resources: ['*'],
      effect: iam.Effect.ALLOW,
      conditions: {
        'StringEquals': {
          'aws:ResourceAccount': cdk.Aws.ACCOUNT_ID
        }
      }
    }));

    consumerLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(queue, {
        batchSize: 10,
        maxConcurrency: 50,
        maxBatchingWindow: cdk.Duration.seconds(1),
      })
    );

    queue.grantConsumeMessages(consumerLambda);

    new logs.LogGroup(this, 'ProcessorLambdaLogGroup', {
      logGroupName: `/aws/lambda/${producerLambda.functionName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const consumerLogGroup = new logs.LogGroup(this, 'ConsumerLambdaLogGroup', {
      logGroupName: `/aws/lambda/${consumerLambda.functionName}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    //Log Group ARN has additional :*
    const logDestination = Fn.select(0, Fn.split(':*', consumerLogGroup.logGroupArn));

    const contributorInsightsRuleDef = this.toJsonString({
      Schema: {
        Name: 'CloudWatchLogRule',
        Version: 1,
      },
      LogGroupARNs: [logDestination],
      LogFormat: 'JSON',
      Contribution: {
        Keys: ['$.tenant'],
        ValueOf: '$.count',
        Filters: [],
      },
      AggregateOn: 'Sum',
    });

    const contributorInsightsRule =  new cloudwatch.CfnInsightRule(this, 'MyCfnInsightRule', {
      ruleName: 'ReceivedMessagesPerMessageGroupId',
      ruleState: 'ENABLED',
      ruleBody: contributorInsightsRuleDef
    });

    const incomingBytesConsumerLogGroup = new cloudwatch.Metric({
      metricName: 'IncomingBytes',
      namespace: 'AWS/Logs',
      dimensionsMap: {
        LogGroupName: consumerLogGroup.logGroupName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    })

    const queueApproximateNumberOfNoisyGroupsMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfNoisyGroups',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Maximum',
    })


    const queueNumberOfMessagesSentMetric = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesSent',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const queueNumberOfMessagesReceivedMetric = new cloudwatch.Metric({
      metricName: 'NumberOfMessagesReceived',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const queueApproximateAgeOfOldestMessageMetric = new cloudwatch.Metric({
      metricName: 'ApproximateAgeOfOldestMessage',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'p99',
    });

    const queueApproximateNumberOfMessagesVisisbleMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfMessagesVisible',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const queueApproximateNumberOfMessageNotVisibleMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfMessagesNotVisible',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });


    const queueApproximateNumberOfMessagesVisibleInQuietGroupsMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfMessagesVisibleInQuietGroups',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const queueApproximateNumberOfMessagesNotVisibleInQuietGroupsMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfMessagesNotVisibleInQuietGroups',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const queueApproximateAgeOfOldestMessageInQuietGroupsMetric = new cloudwatch.Metric({
      metricName: 'ApproximateAgeOfOldestMessageInQuietGroups',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: queue.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'p99',
    });


    const processorLambdaInvocationsMetric = new cloudwatch.Metric({
      metricName: 'Invocations',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: producerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const processorLambdaErrorsMetric = new cloudwatch.Metric({
      metricName: 'Errors',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: producerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });


    const processorLambdaConcurrentExecutionsMetric = new cloudwatch.Metric({
      metricName: 'ConcurrentExecutions',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: producerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'p99',
    });
    const processorLambdaDurationMetric = new cloudwatch.Metric({
      metricName: 'ConcurrentExecutions',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: producerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
    });


    const consumerLambdaInvocationsMetric = new cloudwatch.Metric({
      metricName: 'Invocations',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: consumerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });


    const consumerLambdaErrorsMetric = new cloudwatch.Metric({
      metricName: 'Errors',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: consumerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });
    const consumerLambdaConcurrentExecutionsMetric = new cloudwatch.Metric({
      metricName: 'ConcurrentExecutions',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: consumerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'p99',
    });
    const consumerLambdaDurationMetric = new cloudwatch.Metric({
      metricName: 'Duration',
      namespace: 'AWS/Lambda',
      dimensionsMap: {
        FunctionName: consumerLambda.functionName,
      },
      period: cdk.Duration.minutes(1),
    });

    const dashboard = new cloudwatch.Dashboard(this, 'FairQueuesDashboard', {
      dashboardName: 'FairQueuesDashboard'
    });

    dashboard.addWidgets(
        new ContributorInsightsWidget({
          title: 'Consumed messages by Message Group Id'
        }),
        new cloudwatch.GraphWidget({
          title: 'Approximate Number Of Noisy Groups',
          left: [queueApproximateNumberOfNoisyGroupsMetric],
          width: 12,
        })
    );
    // Create DLQ metrics
    const dlqNumberOfMessagesMetric = new cloudwatch.Metric({
      metricName: 'ApproximateNumberOfMessagesVisible',
      namespace: 'AWS/SQS',
      dimensionsMap: {
        QueueName: dlq.queueName,
      },
      period: cdk.Duration.minutes(1),
      statistic: 'Sum',
    });

    dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Queue Metrics (QuietGroups)',
          left: [queueApproximateNumberOfMessagesVisibleInQuietGroupsMetric, queueApproximateNumberOfMessagesNotVisibleInQuietGroupsMetric],
          right: [queueApproximateAgeOfOldestMessageInQuietGroupsMetric],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'Queue Metrics (All)',
          left: [queueApproximateNumberOfMessagesVisisbleMetric, queueApproximateNumberOfMessageNotVisibleMetric],
          right: [queueApproximateAgeOfOldestMessageMetric],
          width: 12,
        })
    );
    
    dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Dead Letter Queue Messages',
          left: [dlqNumberOfMessagesMetric],
          width: 24,
        })
    );

    dashboard.addWidgets(
        new cloudwatch.GraphWidget({
          title: 'Overall messages sent and received',
          left: [queueNumberOfMessagesSentMetric, queueNumberOfMessagesReceivedMetric],
          width: 12,
        }),
        new cloudwatch.GraphWidget({
          title: 'Incoming Bytes for Consumer Logs',
          left: [incomingBytesConsumerLogGroup],
          width: 12,
        }),
    );

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Producer Lambda Invocations and Errors',
        left: [processorLambdaInvocationsMetric],
        right: [processorLambdaErrorsMetric],
        width: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Producer Lambda Concurrent Executions',
        left: [processorLambdaConcurrentExecutionsMetric],
        right: [processorLambdaDurationMetric],
        width: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Consumer Lambda Invocations and Errors',
        left: [consumerLambdaInvocationsMetric],
        right: [consumerLambdaErrorsMetric],
        width: 6,
      }),
      new cloudwatch.GraphWidget({
        title: 'Consumer Lambda Concurrent Executions',
        left: [consumerLambdaConcurrentExecutionsMetric],
        right: [consumerLambdaDurationMetric],
        width: 6,
      }),
    );

    new cdk.CfnOutput(this, 'ProducerApiEndpoint', {
      value: api.url
    });
    
    // Output the API key value
    new cdk.CfnOutput(this, 'ApiKeyValue', {
      value: apiKey.keyId,
      description: 'API Key ID for accessing the Fair Queue API',
      exportName: 'FairQueueApiKeyId'
    });
  }
}

export class ContributorInsightsWidget extends ConcreteWidget {
  private readonly props: GraphWidgetProps;

  constructor(props: GraphWidgetProps) {
    super(12, 6);
    this.props = props;
  }

  toJson(): any[] {
    return [
      {
        type: 'metric',
        width: this.width,
        height: this.height,
        x: this.x,
        y: this.y,
        properties: {
          insightRule: {
            maxContributorCount: 25,
            orderBy: "Sum",
            ruleName: "ReceivedMessagesPerMessageGroupId",
          },
          legend: { position: LegendPosition.BOTTOM  },
          period: (this.props.period || cdk.Duration.minutes(5)).toSeconds(),
          region: this.props.region || cdk.Aws.REGION,
          title: this.props.title,
          view: 'timeSeries',
        },
      },
    ];
  }
}