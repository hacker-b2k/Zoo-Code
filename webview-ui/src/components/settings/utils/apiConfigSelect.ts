export type ApiConfigSelectOption = {
	id: string
	name: string
}

/**
 * Radix Select reserves the empty string for clearing a selection and throws
 * when a SelectItem uses it. Provider profiles can temporarily contain missing
 * IDs/names while loading or after legacy migrations, so sanitize them before
 * rendering any profile-backed dropdown.
 */
export const getSelectableApiConfigs = <T extends { id?: unknown; name?: unknown }>(
	configs: T[] | undefined | null,
): Array<T & ApiConfigSelectOption> =>
	(configs || []).filter(
		(config): config is T & ApiConfigSelectOption =>
			typeof config?.id === "string" &&
			config.id.trim().length > 0 &&
			typeof config?.name === "string" &&
			config.name.trim().length > 0,
	)
