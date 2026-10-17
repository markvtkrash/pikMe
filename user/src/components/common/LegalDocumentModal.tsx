import { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';
import { BRAND_NAME } from '../../constants/brandTheme';
import { useThemedStyles } from '../../theme/useTheme';

export type DocumentType = 'privacy_policy' | 'terms_of_service' | 'food_disclaimer';

const DOCUMENTS: Record<DocumentType, { title: string; content: string }> = {
  privacy_policy: {
    title: 'Privacy Policy',
    content: `# Privacy Policy - ${BRAND_NAME}

**Effective Date:** October 17, 2026

${BRAND_NAME} is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application.

## Information We Collect

**Account**
- Your email address and password (the password is stored securely and we cannot read it)
- Used to sign you in and to reset your password

**Location Information**
- Precise location used to find nearby restaurants (with your permission)
- Your coordinates are sent to Google to find restaurants and to work out which state you are in
- We do not keep a history of where you have been. To avoid repeating searches, our servers keep the results of recent searches for an area, and the state of an area, for up to 30 days. These are kept by area and are not linked to your account

**User Profile Information**
- Dietary preferences, health goals, cuisine preferences, the kinds of places and ways of getting food you like, allergens if you provide them
- Display name
- Stored in our database

**Usage Data**
- Menu items viewed, items saved/bookmarked
- Quick Find questions and answers
- Timestamps of usage

**Waitlist**
- If you ask to be told when ${BRAND_NAME} opens in your state, we store your email address and that state

**On Your Device Only**
- Some settings, such as the restaurant filters you last used, are saved on your phone and are not sent to us

**App Activity Counts**
- Anonymous events such as opening the app, searching, viewing a restaurant or menu, saving, sharing, and signing up
- Sent with a random ID created on your phone, not linked to your account, email, name, location, or what you type in a search

**Technical Information**
- Device type and OS version
- App version
- IP address (via API logs)

## How We Use Your Information

**Personalization**
- Generate food recommendations based on your preferences
- Filter restaurants matching your dietary needs
- Provide AI-powered advice

**Service Improvement**
- Analyze usage patterns
- Fix bugs and improve features
- Train recommendation algorithms (anonymized data only)

**Communication**
- Send critical notifications
- Respond to support requests
- We DO NOT send marketing emails without consent

**Legal Compliance**
- Comply with legal obligations
- Enforce Terms of Service
- Protect against fraud/abuse

## Third-Party Services

**Google Maps Platform (Places and Geocoding)**
- Purpose: Restaurant search and location lookup
- Privacy: https://policies.google.com/privacy

**SerpApi**
- Purpose: Finding restaurant menu links. It receives place IDs only, no personal information

**Supabase**
- Purpose: Account and user data storage
- Privacy: https://supabase.com/privacy

**AI service providers**
- Purpose: Quick Find, Quick take, and estimated menu items
- Anthropic (Claude): https://www.anthropic.com/legal/privacy
- Quicksilver (quicksilverpro.io), which provides access to other AI models
- Which one handles a request depends on our settings

**What we send to AI providers:** your Quick Find questions, the names of nearby restaurants and dishes, dish nutrition estimates, and the profile choices that help tailor an answer (such as dietary preferences, health goals, cuisine preferences and allergens you have provided). If you describe your preferences in your own words during setup, that text is sent too. We do not send your name or email address. Quick Find uses only menu items we have confirmed.

Where a restaurant has not confirmed its menu, the items shown are AI estimates and are labeled as such.

## Data Security

We implement industry-standard encryption and security measures to protect your data. However, no method of transmission over the internet is 100% secure.

## Your Rights

**GDPR/CCPA Rights (if applicable)**
- Right to access your data
- Right to delete your data
- Right to opt-out of certain processing
- Right to data portability

Contact us at support@markvtkrash.com to exercise these rights.

## Children

${BRAND_NAME} is not intended for children under 13, and we do not knowingly collect personal information from them. If you believe a child has given us information, contact support@markvtkrash.com and we will delete it.

## Data Retention

- Profile data: Kept until account deletion
- Usage data: Kept for up to 12 months for analytics
- Anonymous app activity counts: Deleted after 180 days
- Chat history: Kept until manually deleted by user
- Waitlist emails: Kept until the state opens or you ask us to remove them

## Changes to This Policy

We may update this policy periodically. We will notify you of significant changes via the app or email.

---

For questions, contact: support@markvtkrash.com`,
  },
  terms_of_service: {
    title: 'Terms of Service',
    content: `# Terms of Service - ${BRAND_NAME}

**Effective Date:** October 17, 2026

Welcome to ${BRAND_NAME}! These Terms of Service ("Terms") govern your use of our application. By using ${BRAND_NAME}, you agree to these Terms.

## 1. Use License

${BRAND_NAME} grants you a non-exclusive, non-transferable, revocable license to use the app for personal, non-commercial purposes only.

**You agree NOT to:**
- Reverse engineer or decompile the app
- Sell, transfer, or exploit the app
- Remove copyright or proprietary notices
- Use automated tools to scrape data
- Violate any applicable laws

## 2. User Responsibilities

**You are responsible for:**
- Maintaining account security
- Providing accurate information
- Your use of the app
- Respecting other users' rights

## 3. Limitation of Liability

${BRAND_NAME} is provided "as-is" without warranties. We are NOT liable for:
- Indirect, incidental, consequential damages
- Loss of profit or data
- Interruptions of service
- Reliance on food recommendations

You use ${BRAND_NAME} at your own risk.

## 4. Information Shown in the App

Restaurant details, opening hours, distances, menus and nutrition information come from third parties and from AI estimates, and may be incomplete, out of date, or wrong. A menu that a restaurant has not confirmed is labeled as estimated, and a dish on it may not be offered. Coupons are offered by the restaurants, not by us, and are subject to their terms. Please read our Food Disclaimer.

## 5. Indemnification

You agree to indemnify and hold ${BRAND_NAME} harmless from claims arising from your use of the app or violation of these Terms.

## 6. Intellectual Property

All content, features, and functionality are owned by ${BRAND_NAME} or its licensors. You may not copy or distribute without permission.

## 7. Prohibited Activities

You may NOT:
- Harass or abuse other users
- Post illegal, obscene, or defamatory content
- Interfere with app functionality
- Transmit viruses or malware
- Engage in fraudulent activities

## 8. Termination

We reserve the right to terminate or suspend your account for:
- Violation of these Terms
- Illegal activity
- Abuse
- Inactivity

## 9. Dispute Resolution

- First: Contact us at support@markvtkrash.com
- Then: Good-faith negotiation
- Finally: Binding arbitration (if necessary)

## 10. Changes to Terms

We may update these Terms anytime. Continued use means you accept changes.

## 11. Contact

For questions or legal matters, contact: support@markvtkrash.com

---

Last Updated: October 17, 2026`,
  },
  food_disclaimer: {
    title: 'Food Disclaimer',
    content: `# Food Disclaimer - ${BRAND_NAME}

**IMPORTANT: Please Read Before Using ${BRAND_NAME}**

## Nutritional Information

**Nutritional values provided by ${BRAND_NAME} are approximations only:**
- Values may vary based on preparation methods
- Portion sizes may differ from descriptions
- Ingredients and nutritional content can change
- Manufacturing processes affect accuracy

**YOU are responsible for:**
- Verifying nutritional information with restaurants
- Checking labels on packaged items
- Confirming portion sizes
- Making informed dietary decisions

## Allergen and Dietary Information

**Critical Warning:**

Allergen and dietary information could have changed since our last update. Cross-contamination may occur during food preparation.

**Dietary preferences and dish names:** Dietary preferences you set, and filters such as "Matches my diet", use the words in a dish's name. A name does not show every ingredient or how a dish is made, so a dish that stays in a list may not fit your diet, and a dish that is hidden might have. Always confirm with the restaurant staff before you order.

**ALWAYS:**
1. Inform restaurant staff of allergies
2. Ask about preparation methods
3. Request ingredient lists
4. Be cautious of cross-contamination
5. Verify with current sources

**${BRAND_NAME} is NOT responsible for:**
- Allergic reactions or health issues
- Inaccurate allergen information
- Preparation changes
- Cross-contamination incidents

## Health Conditions

If you have medical conditions, serious allergies, or dietary restrictions:
- Consult healthcare professionals
- Do NOT rely solely on ${BRAND_NAME}
- Verify all information independently
- Take extra precautions

## Estimated Menus and AI Suggestions

Where a restaurant has not confirmed its menu, the items shown are AI estimates and are labeled "estimated". Estimated menus, Quick Find and Quick take are AI-generated and may:
- Contain inaccuracies
- Not reflect actual menu availability (a dish may not be offered)
- Not match your preferences
- Require verification with restaurants

**Use them as SUGGESTIONS ONLY, not definitive advice.**

## Hours, Distances and Availability

Opening hours, distances and other restaurant details come from third parties and can be out of date. Check with the restaurant before you go.

## Religious/Cultural Dietary Requirements

${BRAND_NAME} does not collect or use religious or cultural preferences, and its menu information does not indicate whether food meets any religious dietary requirement.
- Certification and preparation methods vary by restaurant
- Vegetarian, vegan and gluten-free products may use processing aids
- Always confirm with restaurant staff

## Food Safety

- Check expiration dates
- Verify food storage conditions
- Report food safety concerns to health departments
- Call poison control for reactions (Emergency: 911)

## Disclaimer

**${BRAND_NAME} provides information "AS-IS" without warranties of accuracy or completeness.**

By using ${BRAND_NAME}, you acknowledge:
- You understand nutritional info are approximations
- You will verify critical information independently
- You assume responsibility for food safety decisions
- You will consult healthcare providers for medical advice
- ${BRAND_NAME} is not liable for health issues arising from food

## Need Help?

**Emergency (Allergic Reaction):** Call 911 immediately

**Poison Control:** 1-800-222-1222

**Food Safety Issues:** Report to local health department

**General Questions:** support@markvtkrash.com

---

**Stay Safe. Verify Important Information. Trust But Verify.**

Last Updated: October 17, 2026`,
  },
};

interface Props {
  visible: boolean;
  documentType: DocumentType;
  onClose: () => void;
}

export function LegalDocumentModal({ visible, documentType, onClose }: Props) {
  const styles = useThemedStyles(baseStyles);
  const doc = DOCUMENTS[documentType];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{doc.title}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Text style={styles.closeButton}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Content */}
        <ScrollView
          style={styles.content}
          showsVerticalScrollIndicator
          contentContainerStyle={styles.contentContainer}
        >
          <Text style={styles.text}>{doc.content}</Text>
        </ScrollView>

        {/* Close Button */}
        <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const baseStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  closeButton: { fontSize: 28, color: '#999' },
  content: { flex: 1 },
  contentContainer: { padding: 16, paddingBottom: 20 },
  text: { fontSize: 13, color: '#555', lineHeight: 22 },
  closeBtn: {
    backgroundColor: '#1565C0',
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
