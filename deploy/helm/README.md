# huddle on Kubernetes

The app is stateless. Everything that persists is in Postgres and in the
bucket, so this chart is a Deployment, a Service and an Ingress.

## Install

Create the secret first. Nothing sensitive belongs in a values file.

```bash
kubectl create secret generic huddle \
  --from-literal=DATABASE_URL='postgres://user:password@host:5432/huddle' \
  --from-literal=S3_ACCESS_KEY_ID='...' \
  --from-literal=S3_SECRET_ACCESS_KEY='...' \
  --from-literal=SMTP_URL='smtp://user:pass@host:587'
```

```bash
helm install huddle ./deploy/helm \
  --set publicUrl=https://chat.example.com \
  --set ingress.host=chat.example.com \
  --set s3.bucket=huddle \
  --set s3.region=eu-central-1
```

Migrations run on boot and take an advisory lock, so several replicas starting
at once is safe and there is no init container.

## More than one replica

Set `replicaCount` above one and the chart turns on `HUDDLE_CLUSTER`, which
adds the Postgres `LISTEN`/`NOTIFY` relay so instances see each other's
realtime traffic. There is no Redis and no sticky session requirement: a client
can reconnect to any pod and resumes from the sequence it already holds.

## WebSockets

The ingress must not buffer or time out the socket at `/api/realtime`. On
ingress-nginx:

```yaml
ingress:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: '3600'
    nginx.ingress.kubernetes.io/proxy-send-timeout: '3600'
```

A dropped socket is survivable because the client reconnects and replays the
delta, but a sixty second timeout means reconnecting every sixty seconds.

## Bucket CORS

Uploads go straight from the browser to the bucket, so the bucket has to allow
it. See the CORS section in the root README: without it, uploads fail in the
browser while working perfectly from the server.
