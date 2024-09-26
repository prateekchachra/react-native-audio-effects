

import React, { useState } from 'react';
import {
  Button,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';

import {
  Colors,
} from 'react-native/Libraries/NewAppScreen';
import Slider from '@react-native-community/slider';
import { playBrownNoise, playPinkNoise, playSound, playWhiteNoise, stopBrownNoise, stopPinkNoise, stopSound, stopWhiteNoise } from './src/audioEffects';



function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const [whiteNoiseLevel, setWhiteNoiseLevel] = useState(0);
  const [brownNoiseLevel, setBrownNoiseLevel] = useState(0);
  const [pinkNoiseLevel, setPinkNoiseLevel] = useState(0);

  const backgroundStyle = {
    backgroundColor: isDarkMode ? Colors.darker : Colors.lighter,
    flex: 1
  };
  const handleSliderChange = (value: number, type: string) => {
    if(type === 'white'){
      stopBrownNoise();
      stopPinkNoise();
      playWhiteNoise(value);

      setPinkNoiseLevel(0);
      setBrownNoiseLevel(0);
      setWhiteNoiseLevel(value);
    }
    else if (type === 'brown') {
      stopPinkNoise();
      stopWhiteNoise();
      playBrownNoise(value);

      setPinkNoiseLevel(0);
      setWhiteNoiseLevel(0);
      setBrownNoiseLevel(value);
    }
    else if (type === 'pink') {
      stopBrownNoise();
      stopWhiteNoise();
      playPinkNoise(value);

      setPinkNoiseLevel(value);
      setWhiteNoiseLevel(0);
      setBrownNoiseLevel(0);
    }
  }

  const handleStopPress = () => {
    stopBrownNoise();
    stopPinkNoise();
    stopWhiteNoise();

    setPinkNoiseLevel(0);
    setWhiteNoiseLevel(0);
    setBrownNoiseLevel(0);
  }
  return (
    <SafeAreaView style={backgroundStyle}>
      <StatusBar />
      <View style={{flex: 1, justifyContent: 'center', alignItems: 'center'}}>
      <View style={{height: '100%', justifyContent: 'center', }}>
      <Text style={styles.titleStyle}>Play Sound</Text>
      <TouchableOpacity onPress={() => playSound(true, './src/assets/Samples/clap_D#1.wav', 0.4)}>
        <Text>Play my sound</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={() => stopSound()}>
        <View style={styles.buttonStyle}></View>
      </TouchableOpacity>
      <Text style={styles.titleStyle}>Noise Generators</Text>
        <View style={styles.sliderLabelContainer}>
        <Text style={{padding: 12}}>Brown Noise</Text>
          <Slider      
            value={brownNoiseLevel}
            style={styles.sliderContainer}
            tapToSeek
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#000"
            maximumTrackTintColor="#fff"
            onValueChange={(value) => handleSliderChange(value, 'brown')}
          />
          </View>
        <View style={styles.sliderLabelContainer}>
        <Text  style={{padding: 12}}>Pink Noise</Text>
          <Slider      
            value={pinkNoiseLevel}
            style={styles.sliderContainer}
            tapToSeek
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#000"
            maximumTrackTintColor="#fff"
            onValueChange={(value) => handleSliderChange(value, 'pink')}
          />
          </View>
        <View style={styles.sliderLabelContainer}>
        <Text  style={{padding: 12}}>White Noise</Text>
          <Slider     
            value={whiteNoiseLevel} 
            style={styles.sliderContainer}
            tapToSeek
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#000"
            maximumTrackTintColor="#fff"
            onValueChange={(value) => handleSliderChange(value, 'white')}
          />
          </View>
    
          <Button title='Stop'  color="#841584" onPress={handleStopPress}/>
          </View>
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  titleStyle: {
    fontSize: 24, 
    marginVertical: 12, 
    fontWeight: '700'
  },
  sliderContainer: {
    width: 200, 
    height: 40 
  },
  sliderLabelContainer: {
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between'
  },
  buttonStyle: {
    backgroundColor: 'red',
    height: 10,
    width: 10,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,

    elevation: 5,
  }
})

export default App;
