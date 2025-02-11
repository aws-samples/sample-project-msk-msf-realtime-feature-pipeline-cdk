# AWS CDK Project for setup infrastructure

## 1. Prepare to deploy

Project configuration for deploy and clean up.

### 1.1 AWS Account
Create IAM user os SSO user with IAM Identity Center.
* (option 1) If you already configured ```aws profile```
```
export AWS_PROFILE=<your-profile-name> 
```
* (option 2) With secret key and secret access key
```
export AWS_ACCESS_KEY_ID=<your-access-key>
export AWS_SECRET_ACCESS_KEY=<your-secret-access-key>
export AWS_DEFAULT_REGION=<your-default-region>
```

### 1.2 Project Config
Edit config files in ```/packages/infra/config```
* default.yml
* test.yml

### 1.3 Tool install
* Install boto3
```
pip install -U boto3
```

* Install AWS CDK, AWS PDK and other dependencies
```
cd packages/infra
npm install -g aws-cdk pnpm
pnpm install
```

## 2 Deploy Infrastructure

### 2.1 (optional) CDK Bootstrap
If you have not been deployed AWS CDK application in the AWS accout, you have to bootstrap CDK Toolkit.
```
cdk bootstrap
```

### 2.2 Deploy Infrastructure
Note : The CDK deployment takes about 1 hour.
```
cd packages/infra
cdk deploy --all --require-approval never
```

### 2.3 Run the Flink application
After infrastructures are setup, it is able to start the Flink application to aggregate features from streamming data.
* Open AWS Console on your web browser
* Go to 'Managed Apache Flink' service
* On left sidebar, select 'Apache Flink applications'
* Select the Flink application, and clink 'Run' button
* Check the status of application is 'Running'

## 3 Clean up
```
cd packages/infra
cdk destroy --all
```