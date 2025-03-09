import Slider from "@react-native-community/slider"
import { StyleSheet, Text, View } from "react-native"


type NoiseGeneratorSliderProps = {
    noiseLevel: number,
    handleSliderChange: (value: number, noiseType: string) => void,
    label: string,
    noiseType: string
}


export const NoiseGeneratorSlider= ({noiseLevel, handleSliderChange, label, noiseType}: NoiseGeneratorSliderProps) => {
    return (
        <View style={styles.sliderLabelContainer}>
        <Text style={{padding: 12}}>{label}</Text>
          <Slider      
            value={noiseLevel}
            style={styles.sliderContainer}
            tapToSeek
            minimumValue={0}
            maximumValue={1}
            minimumTrackTintColor="#000"
            maximumTrackTintColor="#fff"
            onValueChange={(value) => handleSliderChange(value, noiseType)}
          />
          </View>
    )
}

const styles = StyleSheet.create({
    sliderLabelContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    sliderContainer: {
        width: 200,
        height: 40,
    }
})