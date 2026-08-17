export const downloadBlob = (blob: Blob, fileName: string): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const analysisJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`

export const downloadJson = (value: unknown): void => {
  downloadBlob(new Blob([analysisJson(value)], { type: 'application/json' }), 'analysis.json')
}
