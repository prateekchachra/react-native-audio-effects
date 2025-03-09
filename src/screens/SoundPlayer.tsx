import { StyleSheet, Text, TouchableOpacity, View } from "react-native"
import { playSound, stopSound } from "../audioEffects"




export const SoundPlayer = () => {
    return (
        <View>
              <Text style={styles.titleStyle}>Play Sound</Text>
        <TouchableOpacity onPress={() => playSound(true, './src/assets/Samples/clap_D#1.wav', 0.4)}>
            <Text>Play my sound</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => stopSound()}>
            <View style={styles.buttonStyle}>
                <Text>Stop</Text>
            </View>
      </TouchableOpacity>
        </View>
    )
}

const styles = StyleSheet.create({
    titleStyle: {
      fontSize: 24, 
      marginVertical: 12, 
      fontWeight: '700'
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
  