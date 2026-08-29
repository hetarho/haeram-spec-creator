export class SkillPackageError extends Error {
  constructor(message, details = []) {
    super(message)
    this.name = 'SkillPackageError'
    this.details = details
  }
}

