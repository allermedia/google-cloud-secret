import { protos } from '@google-cloud/secret-manager';

export interface AddSecretRequest {
  request: protos.google.cloud.secretmanager.v1.CreateSecretRequest;
}

export interface GetSecretRequest {
  request: protos.google.cloud.secretmanager.v1.GetSecretRequest;
}

export interface DisableSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.DisableSecretVersionRequest;
}

export interface EnableSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.EnableSecretVersionRequest;
}

export interface AddSecretVersionRequest {
  request: protos.google.cloud.secretmanager.v1.AddSecretVersionRequest;
}

export interface UpdatesSecretRequest {
  request: protos.google.cloud.secretmanager.v1.UpdateSecretRequest;
}
