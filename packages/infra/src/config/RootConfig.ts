// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { Environment } from 'aws-cdk-lib';

interface IMskTopicProps {
  topicName: string;
  numPartitions: number;
  replicationFactor: number;
}
interface IMskConfigProps {
  clusterName: string;
  sourceTopic: IMskTopicProps;
  sinkTopic: IMskTopicProps;
}
interface IFeatureStoreBatchUpdateProps {
  enabled: boolean;
  hour: string;
  minute: string;
}

export interface ICommonContext {
  // project config
  namespace: string;

  // deploy accounts
  env : Environment;

  // MSK props
  mskConfig: IMskConfigProps;

  // Batch props
  featureUpdateBatch: IFeatureStoreBatchUpdateProps;

  // ssm parameters
  parameterStoreKeys: Record<string, string>;
}

export type RootConfig = ICommonContext

export default RootConfig;
