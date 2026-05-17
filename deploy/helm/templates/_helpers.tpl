{{/*
Common labels for all AQA resources.
*/}}
{{- define "aqa.labels" -}}
app.kubernetes.io/name: agentic-qa-kit
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end -}}

{{- define "aqa.selectorLabels" -}}
app.kubernetes.io/name: agentic-qa-kit
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
