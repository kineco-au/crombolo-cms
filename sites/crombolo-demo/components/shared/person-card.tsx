import type { PublishedElement } from '@crombolo/crombolo'

const initials = (name: string) =>
  name
    .split(' ')
    .map((word) => word[0])
    .slice(0, 2)
    .join('')

/** A person from the Library: their photo, or their initials when they have none. */
export async function PersonCard({ person }: { person: PublishedElement }) {
  const name = person.text('fullName')
  const photo = (await person.media('photo'))[0]
  return (
    <li class="person">
      {photo ? (
        <img src={photo.cropUrl({ width: 240, height: 240 })} alt="" />
      ) : (
        <span class="person__monogram" aria-hidden="true">
          {initials(name)}
        </span>
      )}
      <h2>{name}</h2>
      <p class="person__role">{person.text('role')}</p>
      <p>{person.text('bio')}</p>
    </li>
  )
}
