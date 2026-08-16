import { useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, StyleSheet,
} from 'react-native';

export type DocumentType = 'privacy_policy' | 'terms_of_service' | 'food_disclaimer';

const DOCUMENTS: Record<DocumentType, { title: string; content: string }> = {
  privacy_policy: {
    title: 'Privacy Policy',
    content: `# Privacy Policy - PikMe

**Effective Date:** June 17, 2026

PikMe is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our mobile application.

## Information We Collect

**Location Information**
- GPS/Precise location used to find nearby restaurants (with your permission)
- Not permanently stored; used for current session only

**User Profile Information**
- Dietary preferences, health goals, allergens, cuisine preferences
- Display name
- Encrypted and stored in Supabase database

**Usage Data**
- Menu items viewed, items saved/bookmarked
- Chat interactions with Menu Mentor
- Timestamps of usage

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

**Google Places API**
- Purpose: Restaurant information, location data
- Privacy: https://policies.google.com/privacy

**Supabase**
- Purpose: User data storage
- Privacy: https://supabase.com/privacy

**Anthropic (Claude AI)**
- Purpose: Menu recommendations
- Privacy: https://www.anthropic.com/legal/privacy

## Data Security

We implement industry-standard encryption and security measures to protect your data. However, no method of transmission over the internet is 100% secure.

## Your Rights

**GDPR/CCPA Rights (if applicable)**
- Right to access your data
- Right to delete your data
- Right to opt-out of certain processing
- Right to data portability

Contact us at support@pikme.app to exercise these rights.

## Data Retention

- Profile data: Kept until account deletion
- Usage data: Kept for up to 12 months for analytics
- Chat history: Kept until manually deleted by user

## Changes to This Policy

We may update this policy periodically. We will notify you of significant changes via the app or email.

---

For questions, contact: support@pikme.app`,
  },
  terms_of_service: {
    title: 'Terms of Service',
    content: `# Terms of Service - PikMe

**Effective Date:** June 17, 2026

Welcome to PikMe! These Terms of Service ("Terms") govern your use of our application. By using PikMe, you agree to these Terms.

## 1. Use License

PikMe grants you a non-exclusive, non-transferable, revocable license to use the app for personal, non-commercial purposes only.

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

PikMe is provided "as-is" without warranties. We are NOT liable for:
- Indirect, incidental, consequential damages
- Loss of profit or data
- Interruptions of service
- Reliance on food recommendations

You use PikMe at your own risk.

## 4. Indemnification

You agree to indemnify and hold PikMe harmless from claims arising from your use of the app or violation of these Terms.

## 5. Intellectual Property

All content, features, and functionality are owned by PikMe or its licensors. You may not copy or distribute without permission.

## 6. Prohibited Activities

You may NOT:
- Harass or abuse other users
- Post illegal, obscene, or defamatory content
- Interfere with app functionality
- Transmit viruses or malware
- Engage in fraudulent activities

## 7. Termination

We reserve the right to terminate or suspend your account for:
- Violation of these Terms
- Illegal activity
- Abuse
- Inactivity

## 8. Dispute Resolution

- First: Contact us at support@pikme.app
- Then: Good-faith negotiation
- Finally: Binding arbitration (if necessary)

## 9. Changes to Terms

We may update these Terms anytime. Continued use means you accept changes.

## 10. Contact

For legal matters, contact: legal@pikme.app

---

Last Updated: June 17, 2026`,
  },
  food_disclaimer: {
    title: 'Food Disclaimer',
    content: `# Food Disclaimer - PikMe

**IMPORTANT: Please Read Before Using PikMe**

## Nutritional Information

**Nutritional values provided by PikMe are approximations only:**
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

Allergen and dietary restriction information could have changed since our last update. Cross-contamination may occur during food preparation.

**ALWAYS:**
1. Inform restaurant staff of allergies
2. Ask about preparation methods
3. Request ingredient lists
4. Be cautious of cross-contamination
5. Verify with current sources

**PikMe is NOT responsible for:**
- Allergic reactions or health issues
- Inaccurate allergen information
- Preparation changes
- Cross-contamination incidents

## Health Conditions

If you have medical conditions, serious allergies, or dietary restrictions:
- Consult healthcare professionals
- Do NOT rely solely on PikMe
- Verify all information independently
- Take extra precautions

## AI-Generated Recommendations

Menu items and recommendations are AI-generated and may:
- Contain inaccuracies
- Not reflect actual menu availability
- Not match your preferences
- Require verification with restaurants

**Use recommendations as SUGGESTIONS ONLY, not definitive advice.**

## Religious/Cultural Dietary Requirements

Religious and cultural dietary requirements require verification:
- Halal certifications may vary
- Kosher preparations vary by denomination
- Vegan products may use processing aids
- Always confirm with restaurant staff

## Food Safety

- Check expiration dates
- Verify food storage conditions
- Report food safety concerns to health departments
- Call poison control for reactions (Emergency: 911)

## Disclaimer

**PikMe provides information "AS-IS" without warranties of accuracy or completeness.**

By using PikMe, you acknowledge:
- You understand nutritional info are approximations
- You will verify critical information independently
- You assume responsibility for food safety decisions
- You will consult healthcare providers for medical advice
- PikMe is not liable for health issues arising from food

## Need Help?

**Emergency (Allergic Reaction):** Call 911 immediately

**Poison Control:** 1-800-222-1222

**Food Safety Issues:** Report to local health department

**General Questions:** support@pikme.app

---

**Stay Safe. Verify Important Information. Trust But Verify.**

Last Updated: June 17, 2026`,
  },
};

interface Props {
  visible: boolean;
  documentType: DocumentType;
  onClose: () => void;
}

export function LegalDocumentModal({ visible, documentType, onClose }: Props) {
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

const styles = StyleSheet.create({
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
    backgroundColor: '#4CAF50',
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
