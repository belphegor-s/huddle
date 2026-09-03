{{- define "huddle.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "huddle.fullname" -}}
{{- default (printf "%s-%s" .Release.Name (include "huddle.name" .)) .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "huddle.labels" -}}
app.kubernetes.io/name: {{ include "huddle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "huddle.selectorLabels" -}}
app.kubernetes.io/name: {{ include "huddle.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
