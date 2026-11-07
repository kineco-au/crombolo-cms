/** A feature's category as stored, the same in every language. */
export const CATEGORIES = ['editing', 'structure', 'delivery']

/** The dictionary key holding a category's name in the page's language. */
export const categoryKey = (category: string) => `category.${category}`
