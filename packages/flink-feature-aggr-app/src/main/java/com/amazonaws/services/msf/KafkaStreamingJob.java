// Copyright 2025 Amazon.com, Inc. or its affiliates
// SPDX-License-Identifier: MIT-0

package com.amazonaws.services.msf;

import com.amazonaws.services.kinesisanalytics.runtime.KinesisAnalyticsRuntime;
import org.apache.flink.streaming.api.environment.LocalStreamEnvironment;
import org.apache.flink.streaming.api.environment.StreamExecutionEnvironment;
import org.apache.flink.table.api.EnvironmentSettings;
import org.apache.flink.table.api.bridge.java.StreamTableEnvironment;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;


public class KafkaStreamingJob {

    private static final String DEFAULT_GROUP_ID = "default-group";
    private static final String DEFAULT_SOURCE_TOPIC = "log";
    private static final String DEFAULT_SINK_TOPIC = "feature";

    private static final Logger LOG = LoggerFactory.getLogger(KafkaStreamingJob.class);

    private static final String LOCAL_APPLICATION_PROPERTIES_RESOURCE = "flink-application-properties-dev.json";


    private static boolean isLocal(StreamExecutionEnvironment env) {
        return env instanceof LocalStreamEnvironment;
    }


    /**
     * Load application properties from Amazon Managed Service for Apache Flink runtime or from a local resource, when the environment is local
     */
    private static Map<String, Properties> loadApplicationProperties(StreamExecutionEnvironment env) throws IOException {
        if (isLocal(env)) {
            LOG.info("Loading application properties from '{}'", LOCAL_APPLICATION_PROPERTIES_RESOURCE);
            return KinesisAnalyticsRuntime.getApplicationProperties(
                    Objects.requireNonNull(KafkaStreamingJob.class.getClassLoader()
                            .getResource(LOCAL_APPLICATION_PROPERTIES_RESOURCE)).getPath());
        } else {
            LOG.info("Loading application properties from Amazon Managed Service for Apache Flink");
            return KinesisAnalyticsRuntime.getApplicationProperties();
        }
    }

    private static Properties mergeProperties(Properties properties, Properties authProperties) {
        properties.putAll(authProperties);
        return properties;
    }


    public static void main(String[] args) throws Exception {
        // Set up the streaming execution environment
        final StreamExecutionEnvironment env = StreamExecutionEnvironment.getExecutionEnvironment();
        EnvironmentSettings settings = EnvironmentSettings.newInstance().inStreamingMode().build();
        StreamTableEnvironment tableEnv = StreamTableEnvironment.create(env, settings);

        // Load the application properties
        final Map<String, Properties> applicationProperties = loadApplicationProperties(env);


        LOG.info("Application properties: {}", applicationProperties);

        // Get the AuthProperties if present (only relevant when using IAM Auth)
        Properties authProperties = applicationProperties.getOrDefault("AuthProperties", new Properties());

        // Prepare the Source and Sink properties
        Properties inputProperties = mergeProperties(applicationProperties.get("Input0"), authProperties);
        Properties outputProperties = mergeProperties(applicationProperties.get("Output0"), authProperties);

        // Execute SQL with TableApi
        // event time : ISO-8601 https://docs.aws.amazon.com/sagemaker/latest/dg/feature-store-quotas.html
        // AWS MSK Source table
        tableEnv.executeSql(
                "CREATE TABLE source_table (\n" +
                        "  msg_id STRING,\n" +
                        "  msg_type STRING,\n" +
                        "  device_id STRING,\n" +
                        "  location_code STRING,\n" +
                        "  coupon_code STRING,\n" +
                        "  response STRING,\n" +
                        "  create_time TIMESTAMP(3), \n" +
                        "  WATERMARK FOR create_time AS create_time - INTERVAL '5' SECOND \n"+
                ") WITH (\n" +
                        "  'connector' = 'kafka',\n" +
                        "  'topic' = '"+inputProperties.getProperty("topic", DEFAULT_SOURCE_TOPIC)+"',\n" +
                        "  'properties.bootstrap.servers' = '"+inputProperties.getProperty("bootstrap.servers")+"',\n" +
                        "  'properties.group.id' = '"+inputProperties.getProperty("group.id", DEFAULT_GROUP_ID)+"',\n" +
                        "  'properties.security.protocol' = 'SASL_SSL', \n"+
                        "  'properties.sasl.mechanism' = 'AWS_MSK_IAM', \n"+
                        "  'properties.sasl.jaas.config' = 'software.amazon.msk.auth.iam.IAMLoginModule required;', \n"+
                        "  'properties.sasl.client.callback.handler.class' = 'software.amazon.msk.auth.iam.IAMClientCallbackHandler', \n"+
                        "  'format' = 'json', \n" +
                        "  'json.timestamp-format.standard' = 'ISO-8601', \n"+
                        "  'json.fail-on-missing-field' = 'false',\n" +
                        "  'json.ignore-parse-errors' = 'true', \n" +
                        "  'scan.startup.mode' = 'earliest-offset'\n"+
                ")"
        );

        // (Query 1) coupon-prefix-count :: sink table
        tableEnv.executeSql(
                "CREATE TABLE sink_table_coupon_prefix_count (\n" +
                        "  feature_group_name STRING,\n" +
                        "  loc_coupon_prefix STRING,\n" +
                        "  msg_count BIGINT,\n" +
                        "  event_time TIMESTAMP(3)\n" +
                ") WITH (\n" +
                        "  'connector' = 'kafka',\n" +
                        "  'topic' = '"+outputProperties.getProperty("topic", DEFAULT_SINK_TOPIC)+"',\n" +
                        "  'properties.bootstrap.servers' = '"+outputProperties.getProperty("bootstrap.servers")+"',\n" +
                        "  'properties.security.protocol' = 'SASL_SSL', \n"+
                        "  'properties.sasl.mechanism' = 'AWS_MSK_IAM', \n"+
                        "  'properties.sasl.jaas.config' = 'software.amazon.msk.auth.iam.IAMLoginModule required;', \n"+
                        "  'properties.sasl.client.callback.handler.class' = 'software.amazon.msk.auth.iam.IAMClientCallbackHandler', \n"+
                        "  'format' = 'json'\n" +
                ")"
        );

        // (Query 2) proto-coupon-location-invalid-count :: sink table
        tableEnv.executeSql(
                "CREATE TABLE sink_table_loc_invalid_cnt (\n" +
                        "  feature_group_name STRING,\n" +
                        "  location_code STRING,\n" +
                        "  msg_count BIGINT,\n" +
                        "  event_time TIMESTAMP(3)\n" +
                ") WITH (\n" +
                        "  'connector' = 'kafka',\n" +
                        "  'topic' = '"+outputProperties.getProperty("topic", DEFAULT_SINK_TOPIC)+"',\n" +
                        "  'properties.bootstrap.servers' = '"+outputProperties.getProperty("bootstrap.servers")+"',\n" +
                        "  'properties.security.protocol' = 'SASL_SSL', \n"+
                        "  'properties.sasl.mechanism' = 'AWS_MSK_IAM', \n"+
                        "  'properties.sasl.jaas.config' = 'software.amazon.msk.auth.iam.IAMLoginModule required;', \n"+
                        "  'properties.sasl.client.callback.handler.class' = 'software.amazon.msk.auth.iam.IAMClientCallbackHandler', \n"+
                        "  'format' = 'json'\n" +
                ")"
        );

        // SQL Insert Query
        var stmtSet = tableEnv.createStatementSet();

        // (Query 1) coupon-prefix-count :: number of validation requests of last 10 minute, same coupon prefix from same location
        stmtSet.addInsertSql(
                "INSERT INTO sink_table_coupon_prefix_count \n" +
                "SELECT \n" +
                "  'proto-coupon-prefix-count' AS feature_group_name, \n" +
                "  CONCAT(location_code,'#', SUBSTRING(coupon_code, 1, CHAR_LENGTH(coupon_code) - 4)) AS loc_coupon_prefix, \n"+
                "  COUNT(*) AS msg_count, \n" +
                "  MAX(create_time) AS event_time \n" +
                "FROM source_table \n" +
                "GROUP BY \n" +
                "  CONCAT(location_code,'#', SUBSTRING(coupon_code, 1, CHAR_LENGTH(coupon_code) - 4)), \n" +
                "  HOP(create_time, INTERVAL '5' MINUTE, INTERVAL '10' MINUTES)"
        );
        
        // (Query 2) proto-coupon-location-invalid-count :: invalid coupon reauest count in 5 minutes by location
        stmtSet.addInsertSql(
                "INSERT INTO sink_table_loc_invalid_cnt \n" +
                "SELECT \n" +
                "  'proto-coupon-location-invalid-count' AS feature_group_name, \n" +
                "  location_code AS location_code, \n"+
                "  COUNT(*) AS msg_count, \n" +
                "  MAX(create_time) AS event_time \n" +
                "FROM source_table \n" +
                "WHERE response = 'INVALID' \n" +
                "GROUP BY \n" +
                "  location_code, \n" +
                "  TUMBLE(create_time, INTERVAL '5' MINUTE)"
        );

        // TO-DO: additional insert query here

        stmtSet.execute();
    }
}
