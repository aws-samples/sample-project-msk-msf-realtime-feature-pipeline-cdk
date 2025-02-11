// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

import { CdkGraph, FilterPreset, Filters } from "@aws/pdk/cdk-graph";
import { CdkGraphDiagramPlugin } from "@aws/pdk/cdk-graph-plugin-diagram";
import { AwsPrototypingChecks, PDKNag } from "@aws/pdk/pdk-nag";

import config from './config';
import { PersistentStack } from './stacks/persistent-stack';
import { FeatureStoreStack } from './stacks/feature-store-stack';
import { StreamingPipelineStack } from './stacks/streaming-pipeline-stack';
import { StreamingProcessingStack } from './stacks/streaming-processing-stack';
import { ApigwStack } from './stacks/apigw-stack';

/* eslint-disable @typescript-eslint/no-floating-promises */
(async () => {
  const { env, namespace } = config
  const app = PDKNag.app({ nagPacks: [new AwsPrototypingChecks()] });
  
  // Persistent Services
  const persistentStack = new PersistentStack(app, `${namespace}-PersistentStack`, { env });

  // Feature store stack
  const featureStoreStack = new FeatureStoreStack(app, `${namespace}-FeatureStoreStack`, { env });

  // Data Streamming Pipeline
  const streammingPipeline = new StreamingPipelineStack( app, `${namespace}-StreamingPipelineStack`, {
    env,
    persistentStack,
  });
  streammingPipeline.addDependency(persistentStack);

  // Data Processing (real-time/batch)
  const streamingProcessingStack = new StreamingProcessingStack(app, `${namespace}-StreamingProcessingStack`, {
    env,
    persistentStack,
  });
  streamingProcessingStack.addDependency(persistentStack);
  
  // Http API
  new ApigwStack(app, `${namespace}-ApigwStack`, { env });

  // Architecture Diagram
  const graph = new CdkGraph(app, {
    plugins: [
      new CdkGraphDiagramPlugin({
        defaults: {
          filterPlan: {
            preset: FilterPreset.COMPACT,
            filters: [{ store: Filters.pruneCustomResources() }],
          },
        },
      })
    ],
  });

  app.synth();
  await graph.report();
})();
