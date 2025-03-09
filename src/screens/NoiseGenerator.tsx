import { useState } from "react";
import { playBrownNoise, playPinkNoise } from "../audioEffects";
import { stopWhiteNoise } from "../audioEffects";
import { playWhiteNoise } from "../audioEffects";
import { stopPinkNoise } from "../audioEffects";
import { stopBrownNoise } from "../audioEffects";
import { Button, StyleSheet, Text } from "react-native";
import { View } from "react-native";
import { NoiseGeneratorSlider } from "../components/NoiseGeneratorSlider";



export const NoiseGenerator = () => {
    const [whiteNoiseLevel, setWhiteNoiseLevel] = useState(0);
    const [brownNoiseLevel, setBrownNoiseLevel] = useState(0);
    const [pinkNoiseLevel, setPinkNoiseLevel] = useState(0);
    
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
        <View>
            <Text style={styles.titleStyle}>Noise Generators</Text>
            <NoiseGeneratorSlider noiseLevel={brownNoiseLevel}
            label="Brown Noise"
            noiseType="brown"
            handleSliderChange={(value) => handleSliderChange(value, 'brown')} />  
            <NoiseGeneratorSlider noiseLevel={pinkNoiseLevel}
            label="Pink Noise"
            noiseType="pink"
            handleSliderChange={(value) => handleSliderChange(value, 'pink')} />  
            <NoiseGeneratorSlider noiseLevel={whiteNoiseLevel}
            label="White Noise"
            noiseType="white"
            handleSliderChange={(value) => handleSliderChange(value, 'white')} />  
            <Button title='Stop'  color="#841584" onPress={handleStopPress}/>
        </View>
      )
}

const styles = StyleSheet.create({
    titleStyle: {
        fontSize: 24, 
        marginVertical: 12, 
        fontWeight: '700'
      },
})