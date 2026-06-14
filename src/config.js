function hasConfiguredValue(inspectResult) {
  return Boolean(
    inspectResult && (
      Object.prototype.hasOwnProperty.call(inspectResult, 'globalValue') ||
      Object.prototype.hasOwnProperty.call(inspectResult, 'workspaceValue') ||
      Object.prototype.hasOwnProperty.call(inspectResult, 'workspaceFolderValue') ||
      Object.prototype.hasOwnProperty.call(inspectResult, 'globalLanguageValue') ||
      Object.prototype.hasOwnProperty.call(inspectResult, 'workspaceLanguageValue') ||
      Object.prototype.hasOwnProperty.call(inspectResult, 'workspaceFolderLanguageValue')
    )
  );
}

function resolveAiConfigurationValue(config, key, providerDefault) {
  const inspected = typeof config.inspect === 'function' ? config.inspect(key) : undefined;
  if (!hasConfiguredValue(inspected)) {
    return providerDefault;
  }

  return config.get(key, providerDefault);
}

module.exports = { resolveAiConfigurationValue, hasConfiguredValue };
