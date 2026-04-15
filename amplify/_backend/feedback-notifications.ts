import { CfnOutput, type RemovalPolicy } from "aws-cdk-lib";
import type { Stack } from "aws-cdk-lib";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { IFunction } from "aws-cdk-lib/aws-lambda";

import type { FeedbackNotificationsSynthConfig } from "../_shared/synth-env.js";

type FunctionResource = {
  addEnvironment(name: string, value: string): void;
  resources: {
    lambda: IFunction;
  };
};

type FeedbackNotificationsBackend = {
  createStack(name: string): Stack;
  submitProductFeedback: FunctionResource;
};

export function configureFeedbackNotifications(
  backend: FeedbackNotificationsBackend,
  config: FeedbackNotificationsSynthConfig,
  removalPolicy: RemovalPolicy,
): void {
  const stack = backend.createStack("feedback-notifications");
  const topic = new Topic(stack, "FeedbackAlertsTopic", {
    displayName: "BuzzerBeater feedback alerts",
  });
  topic.applyRemovalPolicy(removalPolicy);

  for (const email of parseEmailSubscriptions(config.alertEmails)) {
    topic.addSubscription(new EmailSubscription(email));
  }

  topic.grantPublish(backend.submitProductFeedback.resources.lambda);
  backend.submitProductFeedback.addEnvironment(
    "FEEDBACK_ALERTS_TOPIC_ARN",
    topic.topicArn,
  );

  new CfnOutput(stack, "FeedbackAlertsTopicArn", {
    value: topic.topicArn,
    description: "SNS topic that receives logged-in product feedback alerts.",
  });
}

function parseEmailSubscriptions(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
}
