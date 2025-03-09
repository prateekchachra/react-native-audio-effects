

import React from 'react';
import {
  SafeAreaView,
  StatusBar,
  useColorScheme,
  View,
} from 'react-native';

import {
  Colors,
} from 'react-native/Libraries/NewAppScreen';
import { NoiseGenerator } from './src/screens/NoiseGenerator';
import { SoundPlayer } from './src/screens/SoundPlayer';


function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
    flex: 1
  };

  return (
    <SafeAreaView style={backgroundStyle}>
      <StatusBar />
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
      <View style={{height: '100%', justifyContent: 'center', }}>
        <SoundPlayer />
        <NoiseGenerator />
        </View>
    </View>
    </SafeAreaView>
  );
}
export default App;
