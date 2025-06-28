export interface User {
  id: number;
  name: string;
  email: string;
  createdAt: Date;
}

export class UserService {
  private users: User[] = [];

  addUser(user: Omit<User, 'createdAt'>): void {
    const newUser: User = {
      ...user,
      createdAt: new Date()
    };
    this.users.push(newUser);
  }

  getUserById(id: number): User | undefined {
    return this.users.find(user => user.id === id);
  }

  getUserByEmail(email: string): User | undefined {
    return this.users.find(user => user.email === email);
  }

  getAllUsers(): User[] {
    return [...this.users];
  }

  deleteUser(id: number): boolean {
    const index = this.users.findIndex(user => user.id === id);
    if (index !== -1) {
      this.users.splice(index, 1);
      return true;
    }
    return false;
  }
}