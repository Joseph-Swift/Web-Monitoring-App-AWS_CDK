//lib/web-monitoring-app-stack.js

const cdk = require('aws-cdk-lib');
const lambda = require('aws-cdk-lib/aws-lambda');
const s3 = require('aws-cdk-lib/aws-s3');
const iam = require('aws-cdk-lib/aws-iam');
const cloudwatch = require('aws-cdk-lib/aws-cloudwatch');
const sns = require('aws-cdk-lib/aws-sns');
const snsSubscriptions = require('aws-cdk-lib/aws-sns-subscriptions');
const cloudwatchActions = require('aws-cdk-lib/aws-cloudwatch-actions');
const dynamodb = require('aws-cdk-lib/aws-dynamodb');
const events = require('aws-cdk-lib/aws-events');
const targets = require('aws-cdk-lib/aws-events-targets');
const { Duration } = require('aws-cdk-lib');

class WebMonitoringAppStack extends cdk.Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // Create S3 bucket for artifacts with a unique name
    const bucket = new s3.Bucket(this, 'LambdaArtifactBucket', {
      bucketName: `lambda-artifact-bucket-${this.account}-${this.region}`,
    });
    bucket.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Create DynamoDB table for alarm notifications
    const table = new dynamodb.Table(this, 'AlarmNotificationsTable', {
      partitionKey: { name: 'AlarmName', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'Timestamp', type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create IAM role for the Lambda function
    const role = new iam.Role(this, 'LambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));
    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchFullAccess'));

    // Add permissions to allow DynamoDB PutItem action
    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [table.tableArn],
    }));

    // Define the Lambda layer
    const lambdaLayer = new lambda.LayerVersion(this, 'MyLayer', {
      code: lambda.Code.fromAsset('lambda/layer'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'A layer to include the AWS SDK',
    });

    // Define the Lambda function to obtain availability and latency metrics for the URLs
    const lambdaFunction = new lambda.Function(this, 'WebMetricsLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      role: role,
      timeout: Duration.seconds(30),  // Increase the timeout to 30 seconds
      environment: {
        BUCKET_NAME: bucket.bucketName,
        URLS: 'https://www.google.com,https://swinburne.instructure.com/,https://example.com/404,https://httpstat.us/200?sleep=10000',
        DYNAMODB_TABLE_NAME: table.tableName,  // Use the table name from the table object
      },
      layers: [lambdaLayer],  // Add the layer to the Lambda function
    });

    // Grant necessary permissions to the Lambda function
    bucket.grantReadWrite(lambdaFunction);
    table.grantReadWriteData(lambdaFunction);

    // Create SNS Topic for alarms
    const topic = new sns.Topic(this, 'AlarmTopic', {
      displayName: 'Web Monitoring Alarm Topic',
    });
    topic.addSubscription(new snsSubscriptions.EmailSubscription('qkrdbals0@icloud.com'));

    // Create CloudWatch Alarms and SNS Actions
    const availabilityAlarm = new cloudwatch.Alarm(this, 'AvailabilityAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'WebMonitoring',
        metricName: 'Availability',
        statistic: 'Average',
        period: Duration.minutes(5),  // 5분마다 평가
      }),
      threshold: 90,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'Alarm when availability is less than 90%',
    });
    availabilityAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

    const latencyAlarm = new cloudwatch.Alarm(this, 'LatencyAlarm', {
      metric: new cloudwatch.Metric({
        namespace: 'WebMonitoring',
        metricName: 'Latency',
        statistic: 'Average',
        period: Duration.minutes(5),  // 5분마다 평가
      }),
      threshold: 3000,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when latency exceeds 3 seconds',
    });
    latencyAlarm.addAlarmAction(new cloudwatchActions.SnsAction(topic));

    // Define the EventBridge rule to trigger the Lambda function every 5 minutes
    const rule = new events.Rule(this, 'LambdaPeriodicTrigger', {
      schedule: events.Schedule.rate(Duration.minutes(5)),
    });

    // Add the Lambda function as the target of the EventBridge rule
    rule.addTarget(new targets.LambdaFunction(lambdaFunction));
  }
}

module.exports = { WebMonitoringAppStack };