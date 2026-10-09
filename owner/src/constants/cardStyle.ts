// One look for the cards on the owner's menu pages, so they all match: soft rounded corners and a light shadow.
export const CARD_SHADOW = {
  shadowColor: '#1F2A44',
  shadowOpacity: 0.07,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 3 },
  elevation: 2,
} as const;

export const CARD = {
  backgroundColor: '#fff',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#EEF1F5',
  ...CARD_SHADOW,
} as const;
