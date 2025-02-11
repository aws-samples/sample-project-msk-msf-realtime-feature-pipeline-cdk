# Real-time Feature Aggregation Pipeline

## 1. Overview
This project implements a real-time streaming data aggregation pipeline that provides online/offline features through Amazon SageMaker Feature Store.

### 1.1 Cloud Architecture
The solution architecture consists of:
- Amazon MSK (Managed Streaming for Apache Kafka)
- Amazon Managed Service for Apache Flink
- Amazon SageMaker Feature Store
- AWS CDK for Infrastructure as Code
![cloud_architecture](./docs/cloud-architecture.svg)

### 1.2 Project Structure
```
.
├── notebooks/
│ ├── jupyter/ # jupyter notebook files to run demo
│ └── flink/   # zepplin notebook files to develope Apache Flink SQL queries
├── packages/
│ ├── flink-feature-aggr-app/ # Flink streaming application
│ └── infra/  # CDK infrastructure code
│ └── lambda/ # Deployment configurations
├── scripts/  # Sample scripts to help development
└── README.md
```

## 2. Quick Setup
This project has been thoroughly tested and validated on Linux and MacOS environments.

### 2.1 Pre-requirements
Before proceeding with deployment and development, ensure you have the following tools installed:
* Node.js (version 20.x or higher)
* Docker (version 25.x or higher)
* AWS CLI (latest version)
* Java (version 11 or later)
* Maven (version 3.9.x or higher)

### 2.2 Build Flink Application
Before setting up the cloud infrastructure, build the streaming processing application:
```
cd packages/flink-feature-aggr-app
mvn package
cd ../..
```

### 2.3 Deploy Infrastrcture
For detailed infrastructure deployment instructions, please refer to [packages/infra/README.md](packages/infra/README.md)

## 3. Run Demo

### 3.1 Demo Scenario
The shopping mall operates a mobile coupon system but faces challenges with malicious users who repeatedly attempt random coupon numbers at in-store vending machines. This behavior not only risks the unauthorized use of valid coupons but also disrupts normal customer access to the machines. 

While an ML model is currently in place to detect such fraudulent activities, the real-time verification process requires frequent queries to the transaction history, causing excessive load on the database. 

The mall now seeks a new system that can efficiently aggregate real-time logs to provide quick reference data for the ML detection model.

### 3.2 Generate and publish to simulate coupon issue log
The real-time feature aggregation process initiates when data is inserted into the Amazon DynamoDB table. To demonstrate this functionality, you'll need to generate sample log data.

Navigate to [1_sample_data_generator.ipynb](./notebooks/jupyter/1_sample_data_generator.ipynb) in Jupyter Notebook to generate and publish both normal coupon issuance logs and simulated fraudulent activities.

For detailed implementation, refer to [./notebooks/jupyter/1_sample_data_generator.ipynb](./notebooks/jupyter/1_sample_data_generator.ipynb).

### 3.3 Retrieve aggregated features

This project uses Apache Flink Application to aggregate logs in real-time. The aggregated features are stored in SageMaker Feature Store, which offers two storage options:

* Online Store: Provides instant access to the most recent feature values, optimized for real-time AI/ML model inference. This eliminates the need for time-window based aggregation during each inference execution.

* Offline Store: Maintains a comprehensive history of all aggregated features, stored in Amazon S3. This is particularly useful for feature development and model training, with data accessible via Amazon Athena queries.

For practical examples and implementation details, explore [./notebooks/jupyter/2_access_to_collected_features.ipynb](./notebooks/jupyter/2_access_to_collected_features.ipynb).

## 4. License
* MIT-0
