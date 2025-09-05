import { useState } from 'react'

interface ProfilePictures {
  small?: string
  medium?: string
  large?: string
  original?: string
}

interface ProfileAvatarProps {
  name: string
  profilePictures?: ProfilePictures | null
  profilePictureUrl?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function ProfileAvatar({ 
  name, 
  profilePictures, 
  profilePictureUrl, 
  size = 'md',
  className = '' 
}: ProfileAvatarProps) {
  const [imageError, setImageError] = useState(false)
  
  // Determine the best image URL to use
  const getImageUrl = () => {
    // Priority: profile_picture_url > profile_pictures.small > profile_pictures.medium > profile_pictures.large
    if (profilePictureUrl && !imageError) {
      return profilePictureUrl
    }
    
    if (profilePictures && !imageError) {
      return profilePictures.small || profilePictures.medium || profilePictures.large || profilePictures.original
    }
    
    return null
  }
  
  // Size classes
  const sizeClasses = {
    sm: 'w-8 h-8 text-xs',
    md: 'w-10 h-10 text-sm',
    lg: 'w-12 h-12 text-base'
  }
  
  const imageUrl = getImageUrl()
  const initials = name?.charAt(0)?.toUpperCase() || '?'
  
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={`${name}'s profile picture`}
        className={`${sizeClasses[size]} rounded-full object-cover flex-shrink-0 ${className}`}
        onError={() => setImageError(true)}
      />
    )
  }
  
  // Fallback to initials
  return (
    <div className={`${sizeClasses[size]} bg-gray-300 rounded-full flex items-center justify-center font-medium flex-shrink-0 ${className}`}>
      {initials}
    </div>
  )
}
