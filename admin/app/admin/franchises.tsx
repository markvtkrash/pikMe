import { View, StyleSheet } from 'react-native';
import { FranchiseLookupPanel } from '../../src/components/common/FranchiseLookupPanel';

// Franchise Lookup: browse the known franchise/chain list and add a new one — see
// FranchiseLookupPanel for the shared content (also used as a popup from Franchise
// Menu Management).
export default function AdminFranchiseLookupScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.pageWrapper}>
        <FranchiseLookupPanel />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f6f6f6' },
  pageWrapper: { flex: 1, width: '100%', maxWidth: 900, alignSelf: 'center' },
});
