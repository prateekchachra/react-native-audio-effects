import { StyleSheet, Text, View } from 'react-native';
import { EFFECTS, GENERATORS } from 'react-native-audio-effects';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        {EFFECTS.length} effects, {GENERATORS.length} generators
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontSize: 16,
  },
});
