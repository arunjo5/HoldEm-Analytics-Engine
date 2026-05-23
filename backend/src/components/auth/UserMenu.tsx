'use client'

import {
  Avatar,
  Box,
  Button,
  Menu,
  MenuButton,
  MenuDivider,
  MenuItem,
  MenuList,
  Text,
  useColorModeValue,
} from '@chakra-ui/react'
import { useAuth } from '@/contexts/AuthContext'

export function UserMenu() {
  const { user, signOut } = useAuth()
  const menuBg = useColorModeValue('white', 'gray.800')
  const menuBorderColor = useColorModeValue('gray.200', 'gray.700')

  if (!user) return null

  return (
    <Menu>
      <MenuButton
        as={Button}
        rounded="full"
        variant="link"
        cursor="pointer"
        minW={0}
        p={0}
      >
        <Avatar
          size="sm"
          src={user.image || undefined}
          name={user.name || 'User'}
        />
      </MenuButton>
      <MenuList
        bg={menuBg}
        borderColor={menuBorderColor}
        shadow="xl"
        minW="200px"
      >
        <Box px={3} py={2}>
          <Text fontWeight="semibold" fontSize="sm">
            {user.name}
          </Text>
          <Text fontSize="xs" color="gray.500">
            {user.email}
          </Text>
        </Box>
        <MenuDivider />
        <MenuItem onClick={signOut} color="red.500">
          Sign out
        </MenuItem>
      </MenuList>
    </Menu>
  )
}
