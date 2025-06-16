import { extendTheme } from '@chakra-ui/react'

export const theme = extendTheme({
  colors: {
    brand: {
      50: '#f0f9ff',
      100: '#e0f2fe',
      200: '#bae6fd',
      300: '#7dd3fc',
      400: '#38bdf8',
      500: '#0ea5e9',
      600: '#0284c7',
      700: '#0369a1',
      800: '#075985',
      900: '#0c4a6e',
    },
    poker: {
      felt: '#1B4D3E',
      feltDark: '#0F2E24',
      feltLight: '#2A7D5F',
      feltBorder: '#B8864B',
      feltBorderDark: '#8B6B3D',
    }
  },
  styles: {
    global: {
      body: {
        bg: 'gray.50',
        color: 'gray.800',
      },
    },
  },
  components: {
    Button: {
      baseStyle: {
        fontWeight: 'semibold',
        borderRadius: 'md',
        transition: 'all 0.2s',
      },
      variants: {
        solid: {
          bg: 'brand.500',
          color: 'white',
          _hover: {
            bg: 'brand.600',
            transform: 'translateY(-1px)',
            boxShadow: 'lg',
          },
          _active: {
            bg: 'brand.700',
            transform: 'translateY(0)',
          },
        },
        outline: {
          borderWidth: '2px',
          _hover: {
            bg: 'brand.50',
            borderColor: 'brand.500',
            color: 'brand.500',
          },
        },
      },
      defaultProps: {
        colorScheme: 'brand',
      },
    },
    Progress: {
      baseStyle: {
        track: {
          bg: 'gray.100',
          borderRadius: 'full',
        },
        filledTrack: {
          borderRadius: 'full',
          transition: 'all 0.3s ease-in-out',
        },
      },
    },
    Box: {
      baseStyle: {
        transition: 'all 0.2s',
      },
    },
  },
  config: {
    initialColorMode: 'light',
    useSystemColorMode: true,
  },
}) 