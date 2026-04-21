import { CfnOutput, Stack } from "aws-cdk-lib";
import {
  Certificate,
  CertificateValidation,
} from "aws-cdk-lib/aws-certificatemanager";
import { ManagedLoginVersion, type IUserPool } from "aws-cdk-lib/aws-cognito";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as route53Targets from "aws-cdk-lib/aws-route53-targets";

import { resolveAuthCustomDomainConfig } from "../_shared/synth-env.js";

type AuthCustomDomainBackend = {
  auth: {
    resources: {
      userPool: IUserPool;
    };
  };
};

const authCustomDomainOutputKey = "CognitoCustomAuthDomain";

export const __testing = {
  authCustomDomainOutputKey,
};

export function configureAuthCustomDomain(
  backend: AuthCustomDomainBackend,
): void {
  const config = resolveAuthCustomDomainConfig();
  if (!config) {
    return;
  }

  const userPool = backend.auth.resources.userPool;
  const stack = Stack.of(userPool);
  const hostedZone = route53.HostedZone.fromHostedZoneAttributes(
    stack,
    "CognitoAuthCustomDomainHostedZone",
    {
      hostedZoneId: config.zoneId,
      zoneName: config.zoneName,
    },
  );
  const certificate = new Certificate(
    stack,
    "CognitoAuthCustomDomainCertificate",
    {
      domainName: config.domain,
      validation: CertificateValidation.fromDns(hostedZone),
    },
  );
  const userPoolDomain = userPool.addDomain("CognitoAuthCustomDomain", {
    customDomain: {
      certificate,
      domainName: config.domain,
    },
    managedLoginVersion: ManagedLoginVersion.NEWER_MANAGED_LOGIN,
  });

  new route53.ARecord(stack, "CognitoAuthCustomDomainAliasRecord", {
    recordName: config.domain,
    target: route53.RecordTarget.fromAlias(
      new route53Targets.UserPoolDomainTarget(userPoolDomain),
    ),
    zone: hostedZone,
  });
  new route53.AaaaRecord(stack, "CognitoAuthCustomDomainIpv6AliasRecord", {
    recordName: config.domain,
    target: route53.RecordTarget.fromAlias(
      new route53Targets.UserPoolDomainTarget(userPoolDomain),
    ),
    zone: hostedZone,
  });

  new CfnOutput(stack, authCustomDomainOutputKey, {
    description: "Custom domain for Cognito hosted auth.",
    value: config.domain,
  });
}
