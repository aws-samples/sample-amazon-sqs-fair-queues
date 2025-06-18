# Amazon SQS Fair Queues Sample

This repository contains example code for the Fair Queuing feature of Amazon SQS. The example will simulate multi-tenant traffic on an Amazon SQS Queue and visualize the effects of Fair Queuing via Amazon Cloudwatch dashboards and Contributor Insights.

# Architecture

The example architecture consists of 1/ API Gateway that accepts the number of messages that should be generated for a given set of groups 2/ An AWS Lambda function that uses SendMessageBatch to produce load 3/ The Amazon SQS Queue 4/ An AWS Lambda consumer that receives the messages and tracks the number of messages to evaluate the effects of Fair Queuing 5/ Amazon CloudWatch dashboard to visualize metrics.

# Deployment 

## Prerequisites

- AWS Account
  - the account should have permissions configured to access AmazonEC2ContainerRegistry, AmazonS3, AmazonSQS, AmazonSSM, AWSCloudFormation and IAM (could be configured by assigning specific permission policies); alternatively, Administrator role of the account could be used.
- AWS CDK installed 
  - to install, execute
    ```bash
    sudo npm install -g aws-cdk
    ```
- AWS CLI
- [Artillery](https://www.artillery.io/)
  - to install, execute
    ```bash
    npm install -g artillery@latest
    ```

## Walkthrough
1. Build the application
   ```bash
   cd infrastructure
   ```

   ```bash
   npm install && npm run build
   ```
2. Ensure your AWS account is bootstrapped for AWS CDK

    ```bash
    cdk bootstrap
    ```
3. Deploy the AWS Infrastructure components via the AWS CDK CLI (This will take 1-2 minutes)
    
    ```bash
    cdk deploy --outputs-file outputs.json
    ```

4. Export the API Gateway URL and API Key for simple reuse:
    ```bash
    export API_GW_URL=$(cat outputs.json | jq -r '.CdkSqsFairQueuesStack.ProducerApiEndpoint')
    export API_KEY=$(aws apigateway get-api-key --api-key $(cat outputs.json | jq -r '.CdkSqsFairQueuesStack.ApiKeyValue') --include-value | jq -r '.value')
    ```
5. Simulate Load (Default will generate load for 5 minutes - see loadtest.yaml)

    ```bash
    artillery run -t $API_GW_URL loadtest.yaml 
    ```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

