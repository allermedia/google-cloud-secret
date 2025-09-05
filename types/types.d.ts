import { protos } from '@google-cloud/secret-manager';
import { Metadata } from '@grpc/grpc-js';

export interface AddSecretRequest {
  request: protos.google.cloud.secretmanager.v1.CreateSecretRequest;
  metadata: Metadata;
}

export interface GetSecretRequest {
  request: protos.google.cloud.secretmanager.v1.GetSecretRequest;
  metadata: Metadata;
}

export interface DisableSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.DisableSecretVersionRequest;
  metadata: Metadata;
}

export interface EnableSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.EnableSecretVersionRequest;
  metadata: Metadata;
}

export interface AddSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.AddSecretVersionRequest;
  metadata: Metadata;
}

export interface UpdatesSecretRequest {
  request: protos.google.cloud.secretmanager.v1.UpdateSecretRequest;
  metadata: Metadata;
}

export interface AccessSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.IAccessSecretVersionRequest;
  metadata: Metadata;
}
